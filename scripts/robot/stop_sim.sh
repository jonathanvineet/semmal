#!/usr/bin/env bash
# Stop the SEMMAL launch and any orphaned Gazebo server/bridge it started.
# Patterns are anchored to the real executables so they never match an unrelated shell.
PATS=(
  '^/usr/bin/python3 /opt/ros/jazzy/bin/ros2 launch semmal_bringup'
  '^(/bin/sh -c )?(ruby .*)?gz sim .*semmal_gazebo/worlds/[a-z_]+\.sdf'
  # Gazebo renames its server/GUI processes to exactly this, dropping the world path; a server left
  # behind by a crashed launch only shows up this way (it then serves the same world topics).
  '^gz sim (server|gui)$'
  '^/opt/ros/jazzy/lib/ros_gz_bridge/parameter_bridge'
  '^/opt/ros/jazzy/lib/robot_state_publisher/robot_state_publisher'
  '^/opt/ros/jazzy/lib/tf2_ros/static_transform_publisher .*map'
  '^/usr/bin/python3 [^ ]*/install/semmal_[a-z_]+/lib/'
  '^[^ ]*/install/semmal_gazebo/lib/semmal_gazebo/clock_relay'
)
pkill -INT -f "${PATS[0]}" 2>/dev/null; sleep 3
for p in "${PATS[@]}"; do pkill -TERM -f "$p" 2>/dev/null; done
for _ in 1 2 3 4 5; do
  left=0; for p in "${PATS[@]}"; do pgrep -f "$p" >/dev/null && left=1; done
  [ $left = 0 ] && { echo "SEMMAL simulation stopped"; exit 0; }
  sleep 1
done
for p in "${PATS[@]}"; do pkill -KILL -f "$p" 2>/dev/null; done
echo "SEMMAL simulation stopped (forced)"
