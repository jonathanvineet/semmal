"""motor_sim_node: motor current/temperature and wheel-encoder stream for the Gazebo plant.

Subscribes: /cmd_vel (final, from safety_supervisor), /joint_states (Gazebo wheel joints),
            /sim/motor_fault_overlay (FaultOverlay, simulation only)
Publishes:  /motor/diagnostics (MotorDiagnostics, 50 Hz), /wheel_encoders (JointState, 50 Hz)

In hardware this node is replaced by the real motor driver; the fault overlay subscription
exists only here, so injected values can never reach a hardware build.
"""
import rclpy
from rclpy.clock import Clock, ClockType
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node

from geometry_msgs.msg import Twist
from sensor_msgs.msg import JointState
from semmal_interfaces.msg import FaultOverlay, MotorDiagnostics

from .motor_model import MotorModel, MotorModelConfig, wheel_speeds


class MotorSimNode(Node):
    def __init__(self):
        super().__init__('motor_sim_node')
        p = self.declare_parameter
        self.sep = p('wheel_separation', 0.36).value
        self.radius = p('wheel_radius', 0.06).value
        self.joints = {'left': p('left_joint', 'left_wheel_joint').value,
                       'right': p('right_joint', 'right_wheel_joint').value}
        self.models = {s: MotorModel(MotorModelConfig()) for s in ('left', 'right')}
        self.cmd = (0.0, 0.0)
        self.meas_pos = {'left': None, 'right': None}
        self.meas_vel = {'left': 0.0, 'right': 0.0}
        self.frozen_pos = {'left': None, 'right': None}
        self.overlay = None
        self.steady = Clock(clock_type=ClockType.STEADY_TIME)
        self.last = self._now()

        self.diag_pub = self.create_publisher(MotorDiagnostics, '/motor/diagnostics', 10)
        self.enc_pub = self.create_publisher(JointState, '/wheel_encoders', 10)
        self.create_subscription(Twist, '/cmd_vel', self._on_cmd, 10)
        self.create_subscription(JointState, '/joint_states', self._on_js, 10)
        self.create_subscription(FaultOverlay, '/sim/motor_fault_overlay', self._on_overlay, 10)
        self.create_timer(0.02, self._tick, clock=self.steady)

    def _now(self):
        return self.steady.now().nanoseconds * 1e-9

    def _on_cmd(self, m):
        self.cmd = (m.linear.x, m.angular.z)

    def _on_js(self, m: JointState):
        for side, name in self.joints.items():
            if name in m.name:
                i = m.name.index(name)
                if i < len(m.position):
                    self.meas_pos[side] = m.position[i]
                if i < len(m.velocity):
                    self.meas_vel[side] = m.velocity[i]

    def _on_overlay(self, m: FaultOverlay):
        if m.active:
            if self.overlay is None or self.overlay.injection_id != m.injection_id:
                self.get_logger().warn(f'SIM fault overlay active: {m.scenario_id} on {m.motor} motor')
            self.overlay = m
        elif self.overlay is not None and self.overlay.injection_id == m.injection_id:
            self.get_logger().warn(f'SIM fault overlay ended: {m.scenario_id}')
            self.overlay = None
            self.frozen_pos = {'left': None, 'right': None}

    def _tick(self):
        if self.meas_pos['left'] is None or self.meas_pos['right'] is None:
            return  # no plant data yet: publish nothing so watchdogs see the truth
        now = self._now()
        dt, self.last = now - self.last, now
        cl, cr = wheel_speeds(self.cmd[0], self.cmd[1], self.sep, self.radius)
        cmd = {'left': cl, 'right': cr}
        pos = dict(self.meas_pos)
        vel = dict(self.meas_vel)
        ov = self.overlay
        if ov is not None and ov.encoder_stale and ov.motor in pos:
            if self.frozen_pos[ov.motor] is None:
                self.frozen_pos[ov.motor] = pos[ov.motor]
            pos[ov.motor] = self.frozen_pos[ov.motor]
            vel[ov.motor] = 0.0
        out = {}
        for side in ('left', 'right'):
            cur, temp = self.models[side].update(cmd[side], vel[side], dt)
            if ov is not None and ov.motor == side:
                if ov.override_current:
                    cur = ov.current_a
                if ov.override_temperature:
                    temp = ov.temperature_c
            out[side] = (cur, temp)

        d = MotorDiagnostics()
        d.header.stamp = self.get_clock().now().to_msg()
        d.source = 'gazebo_motor_model'
        d.left_current_a, d.left_temperature_c = map(float, out['left'])
        d.right_current_a, d.right_temperature_c = map(float, out['right'])
        d.left_commanded_rad_s, d.right_commanded_rad_s = float(cl), float(cr)
        d.left_measured_rad_s, d.right_measured_rad_s = float(vel['left']), float(vel['right'])
        d.fault_overlay_active = ov is not None
        self.diag_pub.publish(d)

        e = JointState()
        e.header.stamp = d.header.stamp
        e.name = [self.joints['left'], self.joints['right']]
        e.position = [float(pos['left']), float(pos['right'])]
        e.velocity = [float(vel['left']), float(vel['right'])]
        self.enc_pub.publish(e)


def main():
    rclpy.init()
    node = MotorSimNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
