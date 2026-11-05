#!/usr/bin/env bash
# SIMULATION ONLY. Usage: scripts/robot/inject_fault.sh [left_motor_overcurrent|left_encoder_dropout]
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/robot/env.sh"
ros2 service call /sim/fault_inject semmal_interfaces/srv/InjectFault "{scenario_id: '${1:-left_motor_overcurrent}'}"
