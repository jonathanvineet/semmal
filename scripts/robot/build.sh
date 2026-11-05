#!/usr/bin/env bash
# Regenerates the warehouse world/map from layout.yaml and builds the ROS 2 workspace.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
python3 "$ROOT/ros2_ws/src/semmal_gazebo/scripts/generate_world.py"
cd "$ROOT/ros2_ws" && colcon build --symlink-install "$@"
