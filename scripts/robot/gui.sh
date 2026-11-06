#!/usr/bin/env bash
# Reopen the Gazebo window for the running SEMMAL simulation, camera following the robot.
# Closing the window never stops the simulation or the robot.
#   scripts/robot/gui.sh               # follow the robot
#   scripts/robot/gui.sh follow:=false # free camera
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/robot/env.sh"
if ! pgrep -f 'gz sim .*semmal_gazebo/worlds/' >/dev/null; then
  echo "No SEMMAL simulation is running. Start one: scripts/robot/scenario.sh house" >&2
  exit 1
fi
if pgrep -xf 'gz sim gui' >/dev/null || pgrep -f '^((/bin/sh -c )?ruby [^ ]*/)?gz sim -g( |$)' >/dev/null; then
  echo "A Gazebo window is already open. Close it first (two windows share the camera controls)." >&2
  exit 1
fi
# same GPU choice as run_sim.sh
if [ "${SEMMAL_GPU:-auto}" = auto ] && command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
  export __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia
fi
exec ros2 launch semmal_bringup gui.launch.py "$@"
