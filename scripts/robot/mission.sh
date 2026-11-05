#!/usr/bin/env bash
# Send an ExecuteMission goal. Usage: scripts/robot/mission.sh inspection_point_A [destination ...]
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/robot/env.sh"
[ $# -ge 1 ] || { echo "usage: $0 <waypoint> [waypoint...]"; exit 2; }
wps=$(printf "'%s'," "$@"); wps="[${wps%,}]"
ros2 action send_goal --feedback /mission/execute semmal_interfaces/action/ExecuteMission \
  "{task_id: '${TASK_ID:-task-demo-001}', episode_id: '${EPISODE_ID:-episode-demo-001}', waypoints: $wps, max_speed: 0.4, dwell_s: 1.0, capture_keyframe: true}"
