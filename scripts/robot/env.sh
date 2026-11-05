# Shared environment for every robot script. Source it; do not execute.
# Keeps all ROS 2 (DDS) and gz-transport traffic on this host, so the simulation keeps working when
# Wi-Fi drops or the IP changes. The robot reaches the backend through the gateway (WSS), not DDS.
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
if [ -f "$ROOT/ros2_ws/install/setup.bash" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/ros2_ws/install/setup.bash"
fi
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-42}"
# Forced (a shell profile may already set SUBNET). Opt out with SEMMAL_DISCOVERY_RANGE / SEMMAL_GZ_IP.
export ROS_AUTOMATIC_DISCOVERY_RANGE="${SEMMAL_DISCOVERY_RANGE:-LOCALHOST}"
export GZ_IP="${SEMMAL_GZ_IP:-127.0.0.1}"
