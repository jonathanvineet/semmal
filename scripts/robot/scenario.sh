#!/usr/bin/env bash
# Start the robot stack for one robot set up on this PC (pnpm run setup <name> in services/robot-master).
#   scripts/robot/scenario.sh house              # its hardware decides the body; world by default:
#   scripts/robot/scenario.sh house forest       #   create3 -> house, turtlebot4 -> warehouse, jackal -> forest
# Extra arguments go to the launch (e.g. headless:=true rviz:=true). One robot at a time per PC.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${1:-}"
PROFILE="${SEMMAL_ROBOTS_DIR:-$HOME/.semmal/robots}/$NAME/robot.env"
if [ -z "$NAME" ] || [ ! -f "$PROFILE" ]; then
  echo "usage: $0 <robot name> [house|warehouse|forest] [launch args]" >&2
  [ -n "$NAME" ] && echo "Robot \"$NAME\" is not set up yet: cd services/robot-master && pnpm run setup $NAME" >&2
  exit 2
fi
val() { grep -E "^$1=" "$PROFILE" | head -1 | cut -d= -f2-; }
HW="$(val SEMMAL_HARDWARE)"
export ROBOT_ID="$(val SEMMAL_ROBOT_ID)"
export SEMMAL_DATA_DIR="$(val SEMMAL_DATA_DIR)"
case "$HW" in
  create3) DEFAULT_WORLD=house ;;
  turtlebot4) DEFAULT_WORLD=warehouse ;;
  jackal) DEFAULT_WORLD=forest ;;
  *) echo "Robot \"$NAME\" has no supported hardware set: pnpm run setup $NAME" >&2; exit 2 ;;
esac
WORLD="$DEFAULT_WORLD"
if [ -n "${2:-}" ] && [[ "$2" != *:=* ]]; then WORLD="$2"; shift; fi
shift
echo "Robot \"$NAME\" ($HW, $ROBOT_ID) in the $WORLD world"
exec "$ROOT/scripts/robot/run_sim.sh" world:="$WORLD" hardware:="$HW" "$@"
