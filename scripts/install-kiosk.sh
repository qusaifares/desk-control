#!/usr/bin/env bash
#
# Makes the Pi boot straight into the panel.
#
# Run as your desktop user, NOT with sudo - the autostart belongs to the user
# the desktop logs in as:
#   bash scripts/install-kiosk.sh
#
# It replaces your labwc autostart, which on Raspberry Pi OS is what starts the
# taskbar, desktop background and screen blanking. None of those belong on a
# kiosk. Your previous autostart, if you had one, is kept as autostart.before-kiosk.
# To undo: bash scripts/install-kiosk.sh --remove
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.local/bin/desk-kiosk"
AUTOSTART="$HOME/.config/labwc/autostart"
BACKUP="$AUTOSTART.before-kiosk"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your desktop user, without sudo." >&2
  exit 1
fi

if [ "${1:-}" = "--remove" ]; then
  if [ -f "$BACKUP" ]; then
    mv "$BACKUP" "$AUTOSTART"
    echo "Restored your previous labwc autostart."
  else
    rm -f "$AUTOSTART"
    echo "Removed the kiosk autostart; the normal desktop returns on next login."
  fi
  exit 0
fi

mkdir -p "$(dirname "$BIN")" "$(dirname "$AUTOSTART")"
install -m 755 "$REPO_DIR/deploy/desk-kiosk.sh" "$BIN"

if [ -f "$AUTOSTART" ] && ! grep -q desk-kiosk "$AUTOSTART" && [ ! -f "$BACKUP" ]; then
  cp "$AUTOSTART" "$BACKUP"
fi
echo "$BIN &" > "$AUTOSTART"

cat <<DONE
Kiosk installed. It starts on the next login:

  sudo reboot

To get the desktop back:  bash scripts/install-kiosk.sh --remove
DONE
