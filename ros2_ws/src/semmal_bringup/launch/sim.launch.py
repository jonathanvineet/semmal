"""Gazebo Harmonic world + SEMMAL robot + ros_gz bridge + robot_state_publisher + map->odom.

ros2 launch semmal_bringup sim.launch.py [world:=warehouse|house] [headless:=true] [follow:=false]
The spawn pose comes from the world's layout (config/worlds/<world>.yaml).
"""
import os
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, IncludeLaunchDescription, OpaqueFunction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue

# The GUI camera chases the robot from behind and above (metres, robot frame). Gazebo's own follow
# service (/gui/follow); turn it off with follow:=false.
FOLLOW_OFFSET = 'x: -2.2, y: 0, z: 1.7'
# Wait for the GUI and for the robot to exist in this world, then turn follow on (one shot, ~60 s max).
FOLLOW_SCRIPT = (
    'for i in $(seq 120); do '
    'gz model -m semmal -p >/dev/null 2>&1 && '
    'gz service -s /gui/follow/offset --reqtype gz.msgs.Vector3d --reptype gz.msgs.Boolean --timeout 1000 '
    f'--req "{FOLLOW_OFFSET}" 2>/dev/null | grep -q true && '
    'gz service -s /gui/follow --reqtype gz.msgs.StringMsg --reptype gz.msgs.Boolean --timeout 1000 '
    '--req \'data: "semmal"\' 2>/dev/null | grep -q true && { echo "[follow] GUI camera follows semmal"; exit 0; }; '
    'sleep 0.5; done; echo "[follow] Gazebo GUI did not answer; camera left free" >&2'
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from world_config import resolve  # noqa: E402
from hardware_config import body_for  # noqa: E402


def _setup(context):
    w = resolve(LaunchConfiguration('world').perform(context))
    headless = LaunchConfiguration('headless').perform(context).lower() == 'true'
    x, y, yaw = (str(v) for v in w['spawn'])
    gz_share = get_package_share_directory('semmal_gazebo')
    xacro_file = os.path.join(get_package_share_directory('semmal_description'), 'urdf', 'semmal_robot.urdf.xacro')
    variant = body_for(LaunchConfiguration('hardware').perform(context))
    robot_description = ParameterValue(Command(['xacro ', xacro_file, ' model_name:=semmal', f' variant:={variant}']), value_type=str)
    follow = LaunchConfiguration('follow').perform(context).lower() == 'true'
    args = f'-r -s --headless-rendering {w["sdf"]}' if headless else f'-r {w["sdf"]}'
    extra = [] if headless or not follow else [ExecuteProcess(cmd=['bash', '-c', FOLLOW_SCRIPT], output='screen')]
    return extra + [
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(
                get_package_share_directory('ros_gz_sim'), 'launch', 'gz_sim.launch.py')),
            launch_arguments={'gz_args': args, 'on_exit_shutdown': 'true'}.items()),
        Node(package='robot_state_publisher', executable='robot_state_publisher', output='screen',
             parameters=[{'robot_description': robot_description, 'use_sim_time': True}]),
        Node(package='ros_gz_sim', executable='create', output='screen',
             arguments=['-topic', 'robot_description', '-name', 'semmal',
                        '-x', x, '-y', y, '-z', '0.02', '-Y', yaw]),
        Node(package='ros_gz_bridge', executable='parameter_bridge', name='gz_bridge', output='screen',
             parameters=[{'config_file': os.path.join(gz_share, 'config', 'bridge.yaml'), 'use_sim_time': True}]),
        # Bounded-rate /clock for every use_sim_time node (Gazebo ticks it at the 1 kHz physics rate).
        Node(package='semmal_gazebo', executable='clock_relay', output='screen'),
        # Known start pose: map == Gazebo world frame; DiffDrive odom starts at the spawn pose.
        Node(package='tf2_ros', executable='static_transform_publisher', name='map_to_odom',
             arguments=['--x', x, '--y', y, '--z', '0', '--yaw', yaw, '--frame-id', 'map', '--child-frame-id', 'odom'],
             parameters=[{'use_sim_time': True}]),
    ]


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('world', default_value='warehouse', description='warehouse | house | forest'),
        DeclareLaunchArgument('headless', default_value='false', description='Run gz server only (no GUI)'),
        DeclareLaunchArgument('hardware', default_value='turtlebot4', description='create3 | turtlebot4 | jackal'),
        DeclareLaunchArgument('follow', default_value='true', description='GUI camera follows the robot'),
        OpaqueFunction(function=_setup),
    ])
