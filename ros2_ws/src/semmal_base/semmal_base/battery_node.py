"""battery_node: battery model for the Gazebo plant. Publishes /battery_state (1 Hz).

Linear drain: idle_drain_pct_s + motion_drain_pct_per_m * distance. Illustrative simulation values.
"""
import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node

from nav_msgs.msg import Odometry
from sensor_msgs.msg import BatteryState


class BatteryNode(Node):
    def __init__(self):
        super().__init__('battery_node')
        p = self.declare_parameter
        self.pct = float(p('initial_percentage', 92.0).value)
        self.idle = float(p('idle_drain_pct_s', 0.002).value)
        self.per_m = float(p('motion_drain_pct_per_m', 0.05).value)
        self.speed = 0.0
        self.pub = self.create_publisher(BatteryState, '/battery_state', 10)
        self.create_subscription(Odometry, '/odom', self._on_odom, 10)
        self.create_timer(1.0, self._tick)  # sim time: drains with simulated time

    def _on_odom(self, m):
        self.speed = abs(m.twist.twist.linear.x)

    def _tick(self):
        self.pct = max(0.0, self.pct - self.idle - self.per_m * self.speed * 1.0)
        b = BatteryState()
        b.header.stamp = self.get_clock().now().to_msg()
        b.header.frame_id = 'base_link'
        b.voltage = float(22.0 + 3.2 * self.pct / 100.0)
        b.percentage = float(self.pct / 100.0)
        b.present = True
        b.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        b.power_supply_technology = BatteryState.POWER_SUPPLY_TECHNOLOGY_LION
        self.pub.publish(b)


def main():
    rclpy.init()
    node = BatteryNode()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
