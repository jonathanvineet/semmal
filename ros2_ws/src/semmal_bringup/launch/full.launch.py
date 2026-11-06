"""Everything: Gazebo world + robot + robot stack (+ optional RViz).

APP_MODE=simulation SIM_FAULT_INJECTION_ENABLED=true \
  ros2 launch semmal_bringup full.launch.py [world:=warehouse|house|forest] [hardware:=create3|turtlebot4|jackal] [headless:=true] [rviz:=true] [follow:=false]
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    share = get_package_share_directory('semmal_bringup')
    world = LaunchConfiguration('world')
    return LaunchDescription([
        DeclareLaunchArgument('world', default_value='warehouse', description='warehouse | house | forest'),
        DeclareLaunchArgument('headless', default_value='false'),
        DeclareLaunchArgument('hardware', default_value='turtlebot4', description='create3 | turtlebot4 | jackal'),
        DeclareLaunchArgument('rviz', default_value='false'),
        DeclareLaunchArgument('follow', default_value='true', description='GUI camera follows the robot'),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(share, 'launch', 'sim.launch.py')),
            launch_arguments={'world': world, 'headless': LaunchConfiguration('headless'), 'hardware': LaunchConfiguration('hardware'),
                              'follow': LaunchConfiguration('follow')}.items()),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(share, 'launch', 'robot.launch.py')),
            launch_arguments={'world': world, 'hardware': LaunchConfiguration('hardware')}.items()),
        Node(package='rviz2', executable='rviz2', output='screen',
             arguments=['-d', os.path.join(share, 'config', 'semmal.rviz')],
             parameters=[{'use_sim_time': True}], condition=IfCondition(LaunchConfiguration('rviz'))),
    ])
