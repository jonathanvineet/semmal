#!/usr/bin/env bash
# Prints the robot-side toolchain versions and fails clearly if something required is missing.
set +u
fail=0
need() { if ! command -v "$1" >/dev/null 2>&1; then echo "MISSING: $1 ($2)"; fail=1; fi; }
[ -f /opt/ros/jazzy/setup.bash ] || { echo "MISSING: ROS 2 Jazzy (/opt/ros/jazzy)"; exit 1; }
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
need ros2 "ros-jazzy-ros-base"; need gz "ros-jazzy-ros-gz"; need colcon "python3-colcon-common-extensions"; need xacro "ros-jazzy-xacro"
. /etc/os-release; echo "OS:          $PRETTY_NAME"
echo "ROS_DISTRO:  ${ROS_DISTRO:-?}"
echo "gz sim:      $(gz sim --versions 2>/dev/null | head -1)"
for p in ros-gz-sim ros-gz-bridge robot-state-publisher xacro navigation2 nav2-bringup; do
  v=$(dpkg-query -W -f='${Version}' "ros-jazzy-$p" 2>/dev/null || true)
  printf '%-24s %s\n' "ros-jazzy-$p" "${v:-not installed}"
done
python3 -c "import yaml, numpy, pytest" 2>/dev/null || { echo "MISSING: python3-yaml / numpy / pytest"; fail=1; }
dpkg-query -W ros-jazzy-nav2-bringup >/dev/null 2>&1 || echo "NOTE: Nav2 not installed; mission_executor uses the built-in route-graph follower."
exit $fail
