"""SEMMAL robot stack (no simulator): plant models, diagnostics, safety, incidents, mission.

The world selects the odom origin (spawn pose), waypoint allowlist and geofence.
The fault injector is started only when use_fault_injector:=true AND the node itself finds
APP_MODE=simulation in its environment (it exits otherwise).
"""
import os
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction, Shutdown
from launch.conditions import IfCondition
from launch.substitutions import EnvironmentVariable, LaunchConfiguration
from launch_ros.actions import Node

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from world_config import resolve  # noqa: E402
from hardware_config import body_for  # noqa: E402


def _setup(context):
    w = resolve(LaunchConfiguration('world').perform(context))
    x, y, yaw = w['spawn']
    params = os.path.join(get_package_share_directory('semmal_bringup'), 'config', 'semmal.yaml')
    robot_id = LaunchConfiguration('robot_id').perform(context)
    hardware = LaunchConfiguration('hardware').perform(context)
    world = LaunchConfiguration('world').perform(context)
    common = {'use_sim_time': True}
    origin = {'odom_origin_x': x, 'odom_origin_y': y, 'odom_origin_yaw': yaw}

    def node(pkg, exe, extra=None, **kw):
        return Node(package=pkg, executable=exe, output='screen',
                    parameters=[params, common, *(extra or [])], **kw)

    return [
        node('semmal_base', 'motor_sim_node'),
        node('semmal_base', 'battery_node'),
        node('semmal_base', 'robot_state_node', [origin, {'robot_id': robot_id}]),
        node('semmal_diagnostics', 'diagnostics_node'),
        # The supervisor is the only /cmd_vel publisher and Gazebo's DiffDrive holds the last
        # command forever, so if the supervisor ever exits, the whole simulation shuts down.
        node('semmal_safety', 'safety_supervisor', [origin, {'geofence': w['geofence']}],
             on_exit=Shutdown(reason='safety_supervisor exited: stopping simulation')),
        node('semmal_incident', 'incident_recorder', [{'robot_id': robot_id}]),
        node('semmal_mission', 'mission_executor', [{'waypoints_file': w['waypoints_file']}]),
        # localhost-only bridge to the robot master agent (state file + mission/hold/keyframe API)
        node('semmal_gateway', 'gateway_node', [{'waypoints_file': w['waypoints_file']}]),
        # which supported robot this is, for the device identity service (signed with the robot's key)
        node('semmal_identity', 'identity_node', [{'hardware_model': hardware, 'body': body_for(hardware), 'world': world,
                                                   'runtime': LaunchConfiguration('runtime').perform(context)}]),
        Node(package='semmal_sim_faults', executable='fault_injector', output='screen',
             parameters=[common], condition=IfCondition(LaunchConfiguration('use_fault_injector'))),
    ]


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('world', default_value='warehouse', description='warehouse | house | forest'),
        DeclareLaunchArgument('hardware', default_value='turtlebot4', description='create3 | turtlebot4 | jackal'),
        DeclareLaunchArgument('runtime', default_value='gazebo', description='gazebo (this PC runs the robot in Gazebo) | hardware'),
        DeclareLaunchArgument('robot_id', default_value=EnvironmentVariable('ROBOT_ID', default_value='robot-demo-001')),
        DeclareLaunchArgument('use_fault_injector',
                              default_value=EnvironmentVariable('SIM_FAULT_INJECTION_ENABLED', default_value='false')),
        OpaqueFunction(function=_setup),
    ])
