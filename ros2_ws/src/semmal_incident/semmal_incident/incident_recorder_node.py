"""incident_recorder: writes every critical fault to the durable local spool, first.

Subscribes: /fault_events (raised + critical only), /safety/state, /mission/status
Publishes:  /incidents/recorded (std_msgs/String JSON: incident_id, sequence, stage, manifest_hash)
            /incidents/pending (std_msgs/String JSON summary, 1 Hz)
Never calls the network. Remote persistence (0G Storage, Arkiv) is a later outbox stage.
"""
import json
import os

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from std_msgs.msg import String
from semmal_interfaces.msg import FaultEvent, SafetyState

from .spool import IncidentSpool


def default_spool_path():
    base = os.environ.get('SEMMAL_DATA_DIR') or os.path.join(
        os.environ.get('XDG_DATA_HOME', os.path.expanduser('~/.local/share')), 'semmal')
    return os.path.join(base, 'robot', 'incident_spool.db')


class IncidentRecorder(Node):
    def __init__(self):
        super().__init__('incident_recorder')
        p = self.declare_parameter
        self.robot_id = p('robot_id', os.environ.get('ROBOT_ID', 'robot-demo-001')).value
        path = p('spool_path', '').value or default_spool_path()
        self.spool = IncidentSpool(path)
        self.safety_state = None
        self.task_id = None
        self.episode_id = None
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        reliable = QoSProfile(depth=50, reliability=ReliabilityPolicy.RELIABLE)
        self.rec_pub = self.create_publisher(String, '/incidents/recorded', reliable)
        self.pend_pub = self.create_publisher(String, '/incidents/pending', latched)
        self.create_subscription(FaultEvent, '/fault_events', self._on_fault, reliable)
        self.create_subscription(SafetyState, '/safety/state', self._on_safety, latched)
        self.create_subscription(String, '/mission/status', self._on_mission, latched)
        self.create_timer(1.0, self._publish_pending)
        self.get_logger().info(f'incident spool: {path} ({self.spool.pending_summary()["pending_count"]} pending)')

    def _on_safety(self, m):
        self.safety_state = m.state

    def _on_mission(self, m):
        try:
            d = json.loads(m.data)
        except ValueError:
            return
        self.task_id = d.get('task_id') or None
        self.episode_id = d.get('episode_id') or None

    def _on_fault(self, m: FaultEvent):
        if not (m.active and m.severity == 'critical'):
            return
        summary = {
            'left_motor_current_a': float(m.left_motor_current_a),
            'left_motor_temperature_c': float(m.left_motor_temperature_c),
            'right_motor_current_a': float(m.right_motor_current_a),
            'right_motor_temperature_c': float(m.right_motor_temperature_c),
            'left_encoder_stale': bool(m.left_encoder_stale),
            'right_encoder_stale': bool(m.right_encoder_stale),
        }
        row, created = self.spool.record(
            robot_id=self.robot_id, source_event_id=m.event_id, fault_code=m.fault_code,
            severity=m.severity, sensor_summary=summary, task_id=self.task_id,
            episode_id=self.episode_id, safety_state=self.safety_state)
        if created:
            self.get_logger().error(f'INCIDENT #{row["sequence_number"]} {m.fault_code} recorded '
                                    f'{row["stage"]} {row["incident_id"]}')
        self.rec_pub.publish(String(data=json.dumps({
            'incident_id': row['incident_id'], 'sequence_number': row['sequence_number'],
            'fault_code': row['fault_code'], 'stage': row['stage'],
            'manifest_hash': row['manifest_hash'], 'duplicate': not created})))
        self._publish_pending()

    def _publish_pending(self):
        self.pend_pub.publish(String(data=json.dumps(self.spool.pending_summary())))


def main():
    rclpy.init()
    node = IncidentRecorder()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.spool.close()
        node.destroy_node()
        rclpy.try_shutdown()
