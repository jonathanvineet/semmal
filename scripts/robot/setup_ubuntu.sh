#!/usr/bin/env bash
# Idempotent: installs the robot-side apt packages on Ubuntu 24.04 with ROS 2 Jazzy already configured.
# Needs sudo. Review before running.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y \
  ros-jazzy-ros-gz ros-jazzy-robot-state-publisher ros-jazzy-xacro ros-jazzy-rviz2 \
  ros-jazzy-teleop-twist-keyboard ros-jazzy-tf2-ros python3-colcon-common-extensions \
  python3-yaml python3-pytest
# Optional (Nav2 path, not required by the current mission executor):
#   sudo apt-get install -y ros-jazzy-navigation2 ros-jazzy-nav2-bringup
