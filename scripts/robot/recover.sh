#!/usr/bin/env bash
# Operator recovery request (local console). Usage: scripts/robot/recover.sh <operator_id> "<reason>"
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/scripts/robot/env.sh"
[ $# -ge 1 ] || { echo "usage: $0 <operator_id> [reason]"; exit 2; }
ros2 service call /safety/request_recovery semmal_interfaces/srv/RequestRecovery \
  "{operator_id: '$1', operator_approved: true, reason: '${2:-inspected and cleared}'}"
