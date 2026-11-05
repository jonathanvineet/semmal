"""safety_supervisor: the ONLY node that publishes the final /cmd_vel.

Inputs:  /cmd_vel_nav, /cmd_vel_teleop (Twist), /fault_events, /emergency_stop (Bool, true=pressed),
         /safety/stop_request (Bool), /scan, /odom, /wheel_encoders, /motor/diagnostics (heartbeats)
Outputs: /cmd_vel (Twist, 20 Hz, always), /safety/state (SafetyState, transient_local),
         /fault_events (internal supervisor faults: heartbeat loss, geofence, e-stop input)
Service: /safety/request_recovery (RequestRecovery)

Runs on a steady clock so a stalled /clock cannot freeze it. Never calls AI, network, Arkiv or Storage.
"""
import math
import uuid

import rclpy
from rclpy.clock import Clock, ClockType
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data

from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from sensor_msgs.msg import JointState, LaserScan
from std_msgs.msg import Bool
from semmal_interfaces.msg import FaultEvent, MotorDiagnostics, SafetyState
from semmal_interfaces.srv import RequestRecovery

from .core import SafetyConfig, SafetyCore

COMPONENT = 'safety_supervisor'


class SafetySupervisor(Node):
    def __init__(self):
        super().__init__('safety_supervisor')
        p = self.declare_parameter
        cfg = SafetyConfig(
            max_linear=p('max_linear', 0.5).value,
            max_angular=p('max_angular', 1.5).value,
            max_linear_accel=p('max_linear_accel', 0.8).value,
            max_angular_accel=p('max_angular_accel', 3.0).value,
            stopping_decel=p('stopping_decel', 1.5).value,
            degraded_scale=p('degraded_scale', 0.5).value,
            stop_distance=p('stop_distance', 0.35).value,
            slow_distance=p('slow_distance', 0.9).value,
            sector_half_angle=p('sector_half_angle', 0.6).value,
            footprint_offset=p('footprint_offset', 0.25).value,
            cmd_timeout=p('cmd_timeout', 0.5).value,
            heartbeat_timeouts={
                'scan': p('scan_timeout', 1.0).value,
                'odom': p('odom_timeout', 0.5).value,
                'wheel_encoders': p('encoder_timeout', 0.5).value,
                'motor_diagnostics': p('motor_diag_timeout', 0.5).value,
            },
            startup_grace=p('startup_grace', 30.0).value,
            geofence=tuple(p('geofence', [-9.7, -6.7, 9.7, 6.7]).value),
        )
        # map->odom offset (spawn pose); DiffDrive odometry starts at zero at spawn.
        self.ox = p('odom_origin_x', 0.0).value
        self.oy = p('odom_origin_y', 0.0).value
        self.oyaw = p('odom_origin_yaw', 0.0).value
        rate = p('rate_hz', 20.0).value

        self.steady = Clock(clock_type=ClockType.STEADY_TIME)
        self.core = SafetyCore(cfg, self._now())
        self._last_seq = -1

        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        reliable = QoSProfile(depth=50, reliability=ReliabilityPolicy.RELIABLE)
        self.cmd_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.state_pub = self.create_publisher(SafetyState, '/safety/state', latched)
        self.fault_pub = self.create_publisher(FaultEvent, '/fault_events', reliable)

        self.create_subscription(Twist, '/cmd_vel_nav', lambda m: self._cmd('nav', m), 10)
        self.create_subscription(Twist, '/cmd_vel_teleop', lambda m: self._cmd('teleop', m), 10)
        self.create_subscription(FaultEvent, '/fault_events', self._on_fault, reliable)
        self.create_subscription(Bool, '/emergency_stop', lambda m: self.core.on_estop(m.data), latched)
        self.create_subscription(Bool, '/safety/stop_request', lambda m: self.core.on_stop_request(m.data), latched)
        self.create_subscription(LaserScan, '/scan', self._on_scan, qos_profile_sensor_data)
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_subscription(JointState, '/wheel_encoders',
                                 lambda _m: self.core.on_heartbeat('wheel_encoders', self._now()), 10)
        self.create_subscription(MotorDiagnostics, '/motor/diagnostics',
                                 lambda _m: self.core.on_heartbeat('motor_diagnostics', self._now()), 10)
        self.create_service(RequestRecovery, '/safety/request_recovery', self._on_recovery)

        self.create_timer(1.0 / rate, self._tick, clock=self.steady)
        self.get_logger().info('safety_supervisor up: /cmd_vel is gated by the safety state machine')

    def _now(self):
        return self.steady.now().nanoseconds * 1e-9

    def _cmd(self, source, m):
        self.core.on_cmd(source, m.linear.x, m.angular.z, self._now())

    def _on_fault(self, m: FaultEvent):
        if m.component == COMPONENT:
            return  # our own internal events; tracked inside the core
        self.core.on_fault_event(m.fault_code, m.severity, m.active)
        if m.active and m.severity == 'critical':
            self._tick()  # react now rather than at the next timer tick

    def _on_scan(self, m: LaserScan):
        self.core.on_heartbeat('scan', self._now())
        self.core.on_scan(m.ranges, m.angle_min, m.angle_increment, m.range_min, m.range_max)

    def _on_odom(self, m: Odometry):
        self.core.on_heartbeat('odom', self._now())
        px, py = m.pose.pose.position.x, m.pose.pose.position.y
        c, s = math.cos(self.oyaw), math.sin(self.oyaw)
        self.core.on_pose(self.ox + c * px - s * py, self.oy + s * px + c * py)

    def _on_recovery(self, req, res):
        ok, msg = self.core.request_recovery(req.operator_id, req.operator_approved, self._now())
        self.get_logger().warn(f'recovery request by "{req.operator_id}" ({req.reason}): '
                               f'{"ACCEPTED" if ok else "REJECTED"}: {msg}')
        res.accepted, res.message, res.state = ok, msg, self.core.state
        self._tick()
        return res

    def _tick(self):
        try:
            self._tick_impl()
        except Exception as e:  # never stop publishing: fail to a latched hard stop instead
            self.cmd_pub.publish(Twist())
            self.core.internal_faults.setdefault('SUPERVISOR_INTERNAL_ERROR', repr(e))
            self.get_logger().fatal(f'supervisor tick failed, holding zero velocity: {e!r}')

    def _tick_impl(self):
        out = self.core.step(self._now())
        t = Twist()
        t.linear.x, t.angular.z = out.linear, out.angular
        self.cmd_pub.publish(t)

        for code, active, message in out.new_internal_faults:
            ev = FaultEvent()
            ev.header.stamp = self.get_clock().now().to_msg()
            ev.event_id = str(uuid.uuid4())
            ev.fault_code, ev.severity, ev.active = code, 'critical', active
            ev.component, ev.message = COMPONENT, message
            self.fault_pub.publish(ev)
            # rclpy forbids one call site logging at different severities, so branch explicitly.
            if active:
                self.get_logger().error(f'RAISED {code}: {message}')
            else:
                self.get_logger().info(f'CLEARED {code}: {message}')

        st = SafetyState()
        st.header.stamp = self.get_clock().now().to_msg()
        st.state, st.reason = out.state, out.reason
        st.active_fault_codes = out.active_fault_codes
        st.motion_permitted, st.latched = out.motion_permitted, out.latched
        st.transition_seq = out.transition_seq
        lt = int(out.last_transition * 1e9)
        st.last_transition.sec, st.last_transition.nanosec = lt // 10**9, lt % 10**9
        self.state_pub.publish(st)
        if out.transition_seq != self._last_seq:
            self._last_seq = out.transition_seq
            self.get_logger().warn(f'safety state -> {out.state} ({out.reason})')


def main():
    rclpy.init()
    node = SafetySupervisor()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        try:
            node.cmd_pub.publish(Twist())  # best-effort zero on shutdown
        except Exception:
            pass
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
