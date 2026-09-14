#!/bin/sh
#
# Chromium in kiosk mode, pointed at the local controller.
#
# Started by labwc's autostart, not systemd. Raspberry Pi OS runs labwc on
# Wayland and never activates the user graphical-session.target, so a systemd
# user unit waiting on it simply never starts - and there is no X display for
# DISPLAY=:0 to point at either.

URL="${DESK_KIOSK_URL:-http://127.0.0.1:7420/?kiosk}"
HEALTH="${DESK_KIOSK_HEALTH_URL:-http://127.0.0.1:7420/api/health}"

# Trixie renamed chromium-browser to chromium.
BROWSER="$(command -v chromium || command -v chromium-browser)"
if [ -z "$BROWSER" ]; then
  echo "desk-kiosk: no chromium found" >&2
  exit 1
fi

# Wait for the controller so a cold boot does not open on an error page.
until curl -sf "$HEALTH" >/dev/null 2>&1; do sleep 1; done

# Relaunch if the browser ever exits: the panel has no keyboard to restart it.
# --incognito keeps a power cut from leaving a "restore pages?" bubble, and
# --password-store=basic stops a keyring prompt nobody can type into.
while true; do
  "$BROWSER" \
    --kiosk \
    --incognito \
    --ozone-platform=wayland \
    --password-store=basic \
    --no-first-run \
    --noerrdialogs \
    --disable-infobars \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    "$URL"
  sleep 3
done
