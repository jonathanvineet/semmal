#!/usr/bin/env bash
# Launch Gazebo warehouse + robot + full robot stack in simulation mode.
#   scripts/robot/run_sim.sh               # with Gazebo GUI
#   scripts/robot/run_sim.sh headless:=true rviz:=true
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/robot/env.sh"
# Two simulations on one host share gz-transport topics and corrupt each other's sensor data.
if pgrep -f 'gz sim .*semmal_gazebo/worlds/' >/dev/null; then
  echo "A SEMMAL simulation is already running. Stop it first: scripts/robot/stop_sim.sh" >&2
  exit 1
fi
export APP_MODE=simulation
export SIM_FAULT_INJECTION_ENABLED="${SIM_FAULT_INJECTION_ENABLED:-true}"
export SEMMAL_DATA_DIR="${SEMMAL_DATA_DIR:-$ROOT/data}"
export ROBOT_ID="${ROBOT_ID:-robot-demo-001}"
exec ros2 launch semmal_bringup full.launch.py "$@"
