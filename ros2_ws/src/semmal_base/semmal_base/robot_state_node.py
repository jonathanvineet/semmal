"""robot_state_node: coarse aggregate state on /robot/state (2 Hz) for the robot gateway.

Pose is map-frame (odom + spawn offset). Not used for control.
"""
import json
import math

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState
from std_msgs.msg import String
from semmal_interfaces.msg import RobotState, SafetyState


class RobotStateNode(Node):
    def __init__(self):
        super().__init__('robot_state_node')
        p = self.declare_parameter
        self.robot_id = p('robot_id', 'robot-demo-001').value
        self.ox, self.oy, self.oyaw = (p('odom_origin_x', 0.0).value, p('odom_origin_y', 0.0).value,
                                       p('odom_origin_yaw', 0.0).value)
        self.msg = RobotState()
        self.msg.robot_id = self.robot_id
        self.msg.battery_percentage = float('nan')
        self.msg.safety_state = 'UNKNOWN'
        self.msg.mission_phase = 'IDLE'
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.pub = self.create_publisher(RobotState, '/robot/state', 10)
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_subscription(BatteryState, '/battery_state', self._on_batt, 10)
        self.create_subscription(SafetyState, '/safety/state', self._on_safety, latched)
        self.create_subscription(String, '/mission/status', self._on_mission, latched)
        self.create_timer(0.5, self._tick)

    def _on_odom(self, m):
        q = m.pose.pose.orientation
        yaw = math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
        px, py = m.pose.pose.position.x, m.pose.pose.position.y
        c, s = math.cos(self.oyaw), math.sin(self.oyaw)
        self.msg.x, self.msg.y = self.ox + c * px - s * py, self.oy + s * px + c * py
        self.msg.yaw = math.atan2(math.sin(yaw + self.oyaw), math.cos(yaw + self.oyaw))
        self.msg.linear_speed = m.twist.twist.linear.x

    def _on_batt(self, m):
        self.msg.battery_percentage = float(m.percentage * 100.0)

    def _on_safety(self, m):
        self.msg.safety_state = m.state

    def _on_mission(self, m):
        try:
            d = json.loads(m.data)
        except ValueError:
            return
        self.msg.mission_phase = str(d.get('phase', ''))
        self.msg.active_task_id = str(d.get('task_id') or '')

    def _tick(self):
        self.msg.header.stamp = self.get_clock().now().to_msg()
        self.msg.header.frame_id = 'map'
        self.pub.publish(self.msg)


def main():
    rclpy.init()
    node = RobotStateNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
