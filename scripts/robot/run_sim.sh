#!/usr/bin/env bash
# Launch Gazebo warehouse + robot + full robot stack in simulation mode.
#   scripts/robot/run_sim.sh               # with Gazebo GUI
#   scripts/robot/run_sim.sh headless:=true rviz:=true
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/robot/env.sh"
# Two simulations on one host share gz-transport topics and corrupt each other's sensor data.
# A server orphaned by an earlier launch is only visible as "gz sim server".
if pgrep -f 'gz sim .*semmal_gazebo/worlds/' >/dev/null || pgrep -xf 'gz sim (server|gui)' >/dev/null; then
  echo "A Gazebo simulation is already running (maybe an orphan from an earlier launch). Stop it first: scripts/robot/stop_sim.sh" >&2
  exit 1
fi
export APP_MODE=simulation
export SIM_FAULT_INJECTION_ENABLED="${SIM_FAULT_INJECTION_ENABLED:-true}"
export SEMMAL_DATA_DIR="${SEMMAL_DATA_DIR:-$ROOT/data}"
export ROBOT_ID="${ROBOT_ID:-robot-demo-001}"
# Hybrid-graphics laptops render on the integrated GPU unless asked. Gazebo renders the GUI, the camera
# and the GPU lidar, so use the NVIDIA GPU when its driver works. Opt out: SEMMAL_GPU=default.
if [ "${SEMMAL_GPU:-auto}" = auto ] && command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
  export __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia
  echo "Rendering on $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1) (SEMMAL_GPU=default to use the default GPU)"
fi
exec ros2 launch semmal_bringup full.launch.py "$@"
