#!/usr/bin/env bash
# Install the robot's agent as a systemd user service, so it starts with the PC and restarts on failure.
#   scripts/robot/install_service.sh house     # after `pnpm setup house` (setup asks questions; a service cannot)
#   systemctl --user status semmal-robot@house
#   journalctl --user -u semmal-robot@house -f
# It runs `pnpm start house`: the device identity service (registration) and, once linked, the robot agent.
# One robot runs at a time; starting one stops the others.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="${1:-}"
[ -n "$NAME" ] && [ -f "${SEMMAL_ROBOTS_DIR:-$HOME/.semmal/robots}/$NAME/robot.env" ] || { echo "Set the robot up first: cd services/robot-master && pnpm setup $NAME" >&2; exit 2; }
PNPM="$(command -v pnpm)" || { echo "pnpm not found on PATH" >&2; exit 2; }
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/semmal-robot@.service" <<UNIT
[Unit]
Description=SEMMAL robot agent and device identity (%i)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT/services/robot-master
Environment=PATH=$PATH
ExecStart=$PNPM start %i
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
for u in $(systemctl --user list-units --plain --no-legend 'semmal-robot@*' | awk '{print $1}'); do
  [ "$u" = "semmal-robot@$NAME.service" ] || systemctl --user stop "$u"
done
systemctl --user enable --now "semmal-robot@$NAME.service"
echo "Installed and started semmal-robot@$NAME. Logs: journalctl --user -u semmal-robot@$NAME -f"
