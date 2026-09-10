#!/usr/bin/env bash
#
# Installs the desk controller on a Raspberry Pi.
#
# Run it from a checkout on the Pi itself:
#   sudo bash scripts/install-pi.sh
#
# It builds, installs a systemd service, and generates a pairing token. It does
# not touch display configuration or the kiosk browser - those are separate
# steps in docs/raspberry-pi.md, because they depend on which panel is attached.
set -euo pipefail

INSTALL_DIR=/opt/desk-control
DATA_DIR=/var/lib/desk-control
ENV_FILE=/etc/desk-control.env
SERVICE_USER="${SUDO_USER:-$USER}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash scripts/install-pi.sh" >&2
  exit 1
fi

echo "==> Checking Node"
if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Install Node 20 or newer first:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs" >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node $node_major is too old; this needs 20 or newer." >&2
  exit 1
fi
echo "    node $(node -v) on $(uname -m)"

echo "==> Building (this takes a few minutes on a Pi)"
sudo -u "$SERVICE_USER" bash -lc "cd '$REPO_DIR' && corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile && pnpm build"

echo "==> Installing to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
# The controller bundle keeps its runtime deps external, so node_modules comes
# along with it. Workspace packages are already bundled in.
rsync -a --delete \
  --include='apps/' --include='apps/controller/' --include='apps/controller/dist/***' \
  --include='apps/web/' --include='apps/web/dist/***' \
  --include='node_modules/***' \
  --include='package.json' \
  --exclude='*' \
  "$REPO_DIR/" "$INSTALL_DIR/"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Generating $ENV_FILE"
  token="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  cat > "$ENV_FILE" <<ENV
# Desk controller configuration.

# Bound to every interface so agents on the desk's computers can reach it.
# This is a LAN service with no transport encryption - keep it on a network you
# trust, and never forward this port.
DESK_CONTROL_HOST=0.0.0.0
DESK_CONTROL_PORT=7420

# Shared secret every agent must present. Regenerate by deleting this file and
# re-running the installer.
DESK_CONTROL_PAIRING_TOKEN=$token

DESK_CONTROL_DATA_DIR=$DATA_DIR
DESK_CONTROL_WEB_DIR=$INSTALL_DIR/apps/web/dist
DESK_CONTROL_LOG_LEVEL=info
NODE_ENV=production
ENV
  chmod 600 "$ENV_FILE"
else
  echo "==> Keeping existing $ENV_FILE"
fi

echo "==> Installing the service"
sed "s/%i/$SERVICE_USER/g" "$REPO_DIR/deploy/desk-controller.service" \
  > /etc/systemd/system/desk-controller.service
systemctl daemon-reload
systemctl enable desk-controller
systemctl restart desk-controller

sleep 3
if systemctl is-active --quiet desk-controller; then
  ip="$(hostname -I | awk '{print $1}')"
  token="$(grep DESK_CONTROL_PAIRING_TOKEN "$ENV_FILE" | cut -d= -f2)"
  cat <<DONE

Controller is running.

  Panel        http://localhost:7420
  From the LAN http://$ip:7420

Point each agent at it, with the pairing token:

  DESK_CONTROL_URL=ws://$ip:7420/agent
  DESK_CONTROL_PAIRING_TOKEN=$token

Logs:    journalctl -u desk-controller -f
Kiosk:   see docs/raspberry-pi.md
DONE
else
  echo "Controller failed to start. Check: journalctl -u desk-controller -n 50" >&2
  exit 1
fi
