"""Gazebo Harmonic world + SEMMAL robot + ros_gz bridge + robot_state_publisher + map->odom.

ros2 launch semmal_bringup sim.launch.py [world:=warehouse|house] [headless:=true] [follow:=false]
The spawn pose comes from the world's layout (config/worlds/<world>.yaml).
The Gazebo server runs on its own; the window (gui.launch.py) opens once the robot has spawned, so it
always shows the robot and the camera can follow it. Closing the window leaves the simulation running.
"""
import os
import sys

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction, RegisterEventHandler
from launch.event_handlers import OnProcessExit
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue

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
    args = f'-r -s --headless-rendering {w["sdf"]}' if headless else f'-r -s {w["sdf"]}'
    spawn = Node(package='ros_gz_sim', executable='create', output='screen',
                 arguments=['-topic', 'robot_description', '-name', 'semmal',
                            '-x', x, '-y', y, '-z', '0.02', '-Y', yaw])
    # A window started together with the server can still be loading when the robot spawns and miss it;
    # then it never shows the robot and cannot follow it. So it opens once the spawn has finished.
    window = [] if headless else [RegisterEventHandler(OnProcessExit(target_action=spawn, on_exit=[
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(get_package_share_directory('semmal_bringup'), 'launch', 'gui.launch.py')),
            launch_arguments={'follow': LaunchConfiguration('follow')}.items())]))]
    return window + [
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(
                get_package_share_directory('ros_gz_sim'), 'launch', 'gz_sim.launch.py')),
            launch_arguments={'gz_args': args, 'on_exit_shutdown': 'true'}.items()),
        Node(package='robot_state_publisher', executable='robot_state_publisher', output='screen',
             parameters=[{'robot_description': robot_description, 'use_sim_time': True}]),
        spawn,
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
        DeclareLaunchArgument('headless', default_value='false', description='No window, and sensors render off-screen'),
        DeclareLaunchArgument('hardware', default_value='turtlebot4', description='create3 | turtlebot4 | jackal'),
        DeclareLaunchArgument('follow', default_value='true', description='GUI camera follows the robot'),
        OpaqueFunction(function=_setup),
    ])
