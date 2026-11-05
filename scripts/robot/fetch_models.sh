#!/usr/bin/env bash
# Download the pinned Gazebo Fuel models used by the worlds into the local Fuel cache
# (~/.gz/fuel). Needs internet once; afterwards the simulation runs offline.
# Models and licences: ros2_ws/src/semmal_gazebo/config/models.yaml (OpenRobotics, CC BY 4.0).
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
uris=$(python3 -c "import yaml,sys; [print(m['uri']) for m in yaml.safe_load(open(sys.argv[1]))['models'].values()]" \
  "$ROOT/ros2_ws/src/semmal_gazebo/config/models.yaml")
fail=0
for u in $uris; do
  if gz fuel download -u "$u" >/dev/null 2>&1; then echo "ok    $u"; else echo "FAIL  $u"; fail=1; fi
done
exit $fail
