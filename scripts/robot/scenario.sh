#!/usr/bin/env bash
# One scenario = one world + its robot body, for the robot registered on Arkiv.
#   scripts/robot/scenario.sh house     rbt-xxxxxxxxxx    # cleaning robot in the house
#   scripts/robot/scenario.sh warehouse rbt-xxxxxxxxxx    # inspection rover in the warehouse
#   scripts/robot/scenario.sh forest    rbt-xxxxxxxxxx    # field rover on the forest trail
# Extra arguments go to the launch (e.g. headless:=true rviz:=true). One simulation at a time.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "${1:-}" in
  house)     WORLD=house;     BODY=cleaner ;;
  warehouse) WORLD=warehouse; BODY=rover ;;
  forest)    WORLD=forest;    BODY=field ;;
  *) echo "usage: $0 house|warehouse|forest <robot-id from the dashboard> [launch args]" >&2; exit 2 ;;
esac
if [ -z "${2:-}" ] || [[ "$2" != rbt-* ]]; then
  echo "Give the robot id shown in the dashboard (rbt-...), so incidents carry the right robot." >&2
  exit 2
fi
export ROBOT_ID="$2"
shift 2
exec "$ROOT/scripts/robot/run_sim.sh" world:="$WORLD" robot:="$BODY" "$@"
