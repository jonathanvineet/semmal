"""identity_node: publishes this robot's identity facts and keeps them in a file for the device
identity service.

  /robot/identity            std_msgs/String (JSON), latched
  $SEMMAL_IDENTITY_FILE      {"facts": {...}, "updatedAt": <unix s>}, rewritten every 2 s
                             (default $SEMMAL_DATA_DIR/robot/identity.json)

Parameters: hardware_model (create3 | turtlebot4 | jackal), runtime (gazebo | hardware), body, world.
The loaded robot description comes from /robot_description (robot_state_publisher, latched).
The file is only written while the robot stack runs, so a stale file means the robot is not up.
"""
import json
import os
import time

import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String

from .core import facts


def write_atomic(path, doc):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f)
    os.replace(tmp, path)


class IdentityNode(Node):
    def __init__(self):
        super().__init__('semmal_identity')
        data = os.environ.get('SEMMAL_DATA_DIR', os.path.expanduser('~/.semmal'))
        self.model = self.declare_parameter('hardware_model', 'turtlebot4').value
        self.runtime = self.declare_parameter('runtime', 'gazebo').value
        self.body = self.declare_parameter('body', '').value
        self.world = self.declare_parameter('world', '').value
        self.path = os.environ.get('SEMMAL_IDENTITY_FILE', os.path.join(data, 'robot', 'identity.json'))
        self.description = ''
        latched = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.pub = self.create_publisher(String, '/robot/identity', latched)
        self.create_subscription(String, '/robot_description', self._on_description, latched)
        self.facts = None
        self._refresh()
        self.create_timer(2.0, self._write)
        self.get_logger().info(f'identity: {self.model} ({self.runtime}), file {self.path}')

    def _on_description(self, m):
        if m.data != self.description:
            self.description = m.data
            self._refresh()

    def _refresh(self):
        self.facts = facts(model=self.model, runtime=self.runtime, body=self.body, description=self.description,
                           world=self.world, ros_distro=os.environ.get('ROS_DISTRO', ''))
        self.pub.publish(String(data=json.dumps(self.facts, sort_keys=True)))
        self._write()

    def _write(self):
        if not self.description:
            return  # not up until the robot description is loaded
        try:
            write_atomic(self.path, {'facts': self.facts, 'updatedAt': time.time()})
        except OSError as e:
            self.get_logger().warn(f'identity file: {e}')


def main():
    rclpy.init()
    node = IdentityNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
