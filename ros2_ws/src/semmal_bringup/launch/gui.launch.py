"""The Gazebo window (GUI client) for a running SEMMAL simulation, with the camera following the robot.

sim.launch.py starts this only after the robot has spawned, so the window always loads the robot (a GUI
that is still starting when the robot spawns can miss it, and then cannot follow it). Closing the window
does not stop the simulation or the robot; reopen it with scripts/robot/gui.sh.

  ros2 launch semmal_bringup gui.launch.py [follow:=false]
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, ExecuteProcess, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration

HERE = os.path.dirname(os.path.abspath(__file__))
# window layout with a narrower (zoomed-in) camera lens
GUI_CONFIG = os.path.join(os.path.dirname(HERE), 'config', 'gazebo_gui.config')


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('follow', default_value='true', description='GUI camera follows the robot'),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(
                get_package_share_directory('ros_gz_sim'), 'launch', 'gz_sim.launch.py')),
            # GUI only; closing it must not shut the simulation down
            launch_arguments={'gz_args': f'-g --gui-config {GUI_CONFIG}', 'on_exit_shutdown': 'false'}.items()),
        ExecuteProcess(cmd=['python3', os.path.join(HERE, 'follow_camera.py'), 'semmal'], output='screen',
                       condition=IfCondition(LaunchConfiguration('follow'))),
    ])
