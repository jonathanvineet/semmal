"""diagnostics_node: turns motor/encoder/battery streams into structured fault events.

Subscribes: /motor/diagnostics (MotorDiagnostics), /wheel_encoders (JointState), /battery_state
Publishes:  /fault_events (FaultEvent, reliable depth 50) on every raise/clear,
            /diagnostics (diagnostic_msgs/DiagnosticArray, 2 Hz)
Evaluated at 50 Hz on a steady clock. No network, no AI.
"""
import uuid

import rclpy
from rclpy.clock import Clock, ClockType
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy

from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from sensor_msgs.msg import BatteryState, JointState
from semmal_interfaces.msg import FaultEvent, MotorDiagnostics

from .core import DiagnosticsConfig, DiagnosticsCore


class DiagnosticsNode(Node):
    def __init__(self):
        super().__init__('diagnostics_node')
        p = self.declare_parameter
        cfg = DiagnosticsConfig(
            overcurrent_a=p('overcurrent_a', 6.0).value,
            overtemp_c=p('overtemp_c', 90.0).value,
            debounce_s=p('debounce_s', 0.2).value,
            clear_hold_s=p('clear_hold_s', 2.0).value,
            encoder_stale_s=p('encoder_stale_s', 0.5).value,
            motion_eps=p('motion_eps', 0.5).value,
            mismatch_tol=p('mismatch_tol', 3.0).value,
            mismatch_s=p('mismatch_s', 1.5).value,
            watchdog_s=p('watchdog_s', 0.5).value,
            battery_low_pct=p('battery_low_pct', 15.0).value,
            battery_critical_pct=p('battery_critical_pct', 5.0).value,
        )
        self.left_joint = p('left_joint', 'left_wheel_joint').value
        self.right_joint = p('right_joint', 'right_wheel_joint').value
        self.core = DiagnosticsCore(cfg)
        self.steady = Clock(clock_type=ClockType.STEADY_TIME)

        reliable = QoSProfile(depth=50, reliability=ReliabilityPolicy.RELIABLE)
        self.fault_pub = self.create_publisher(FaultEvent, '/fault_events', reliable)
        self.diag_pub = self.create_publisher(DiagnosticArray, '/diagnostics', 10)
        self.create_subscription(MotorDiagnostics, '/motor/diagnostics', self._on_motor, 10)
        self.create_subscription(JointState, '/wheel_encoders', self._on_enc, 10)
        self.create_subscription(BatteryState, '/battery_state', self._on_batt, 10)
        self.create_timer(0.02, self._tick, clock=self.steady)
        self.create_timer(0.5, self._publish_diag, clock=self.steady)

    def _now(self):
        return self.steady.now().nanoseconds * 1e-9

    def _on_motor(self, m: MotorDiagnostics):
        self.core.on_motor(self._now(), m.left_current_a, m.right_current_a, m.left_temperature_c,
                           m.right_temperature_c, m.left_commanded_rad_s, m.right_commanded_rad_s,
                           m.left_measured_rad_s, m.right_measured_rad_s)

    def _on_enc(self, m: JointState):
        try:
            li, ri = m.name.index(self.left_joint), m.name.index(self.right_joint)
        except ValueError:
            return
        self.core.on_encoders(self._now(), m.position[li], m.position[ri])

    def _on_batt(self, m: BatteryState):
        self.core.on_battery(m.percentage * 100.0)

    def _tick(self):
        for e in self.core.step(self._now()):
            s = self.core.summary()
            ev = FaultEvent()
            ev.header.stamp = self.get_clock().now().to_msg()
            ev.event_id = str(uuid.uuid4())
            ev.fault_code, ev.severity, ev.active = e['code'], e['severity'], e['active']
            ev.component, ev.message = e['component'], e['message']
            ev.left_motor_current_a = float(s['left_motor_current_a'])
            ev.left_motor_temperature_c = float(s['left_motor_temperature_c'])
            ev.right_motor_current_a = float(s['right_motor_current_a'])
            ev.right_motor_temperature_c = float(s['right_motor_temperature_c'])
            ev.left_encoder_stale = bool(s['left_encoder_stale'])
            ev.right_encoder_stale = bool(s['right_encoder_stale'])
            self.fault_pub.publish(ev)
            text = f'{"RAISED" if e["active"] else "CLEARED"} {e["code"]} [{e["severity"]}]: {e["message"]}'
            # rclpy forbids one call site logging at different severities, so branch explicitly.
            if e['active'] and e['severity'] == 'critical':
                self.get_logger().error(text)
            else:
                self.get_logger().warn(text)

    def _publish_diag(self):
        arr = DiagnosticArray()
        arr.header.stamp = self.get_clock().now().to_msg()
        active = self.core.active_faults()
        st = DiagnosticStatus()
        st.name, st.hardware_id = 'semmal/drive', 'semmal_robot'
        if any(v == 'critical' for v in active.values()):
            st.level = DiagnosticStatus.ERROR
        elif active:
            st.level = DiagnosticStatus.WARN
        else:
            st.level = DiagnosticStatus.OK
        st.message = ', '.join(sorted(active)) or 'OK'
        st.values = [KeyValue(key=k, value=f'{v:.3f}' if isinstance(v, float) else str(v))
                     for k, v in self.core.summary().items()]
        arr.status.append(st)
        self.diag_pub.publish(arr)


def main():
    rclpy.init()
    node = DiagnosticsNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == '__main__':
    main()
