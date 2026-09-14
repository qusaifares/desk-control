# Running the panel on a Raspberry Pi

The Pi is the **control plane host**. It runs the controller, serves the web UI, and — once the USB
switch is wired to its GPIO — drives peripheral switching. It never carries video, and it never
carries keyboard or mouse data.

It does **not** run an agent: it has no monitors of its own to control. The desk's displays are
driven over DDC/CI by agents on the computers that are cabled to them.

## What you need

- A Raspberry Pi 4 or 5 (ARM64), power supply, and an SD card or USB stick
- Raspberry Pi OS 64-bit **with desktop**, Bookworm or Trixie (verified on Trixie, Pi 5)
- The panel, on HDMI or DSI
- Node 22+ (24 recommended)

## 1. Flash the card

Use Raspberry Pi Imager and set the hostname, your user, Wi-Fi and SSH in the imager's advanced
options before writing — it saves a keyboard-and-monitor round trip. The examples below use
`desk-hub`; substitute whatever you chose.

No SD card reader? Flash a USB stick instead and boot with the SD slot empty. A Pi 5 does this out
of the box; a Pi 4 may need its bootloader updated first.

Check the power supply is adequate before going further. `0x0` means no undervoltage or throttling
has happened since boot:

```bash
vcgencmd get_throttled && vcgencmd pmic_read_adc EXT5V_V
```

## 2. Install Node

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
```

## 3. Install the controller

```bash
git clone https://github.com/qusaifares/desk-control.git && cd desk-control
```

```bash
sudo bash scripts/install-pi.sh
```

That builds, installs a systemd service, generates a pairing token, and prints the URL and the
token to give each agent. Building on a Pi takes a few minutes.

### What the installer decides for you

**It binds to `0.0.0.0`.** The whole point is that agents on other machines reach it, which localhost
cannot do. That is the first time this service is exposed beyond one machine, so the installer
generates a pairing token and writes it to `/etc/desk-control.env` with mode 600.

Be clear-eyed about what that is: a shared secret over plain HTTP on a LAN. It stops a stray device
joining your desk; it does not stop anyone who can already watch your network. Do not forward the
port. The per-agent-key design that replaces it is in [protocol.md](protocol.md).

## 4. Point an agent at it

On the Windows PC:

```bash
DESK_CONTROL_URL=ws://desk-hub.local:7420/agent DESK_CONTROL_PAIRING_TOKEN=<token> node apps/agent/dist/index.js
```

Its monitors should appear on the panel within a few seconds.

## 5. The display

Check what the panel reports before changing anything:

```bash
kmsprint | head -10
```

The 1920×440 panel on this desk advertises its own mode and came up at `1920x440@60.00` with no
configuration at all. Only if yours does not, force it by appending to the single line in
`/boot/firmware/cmdline.txt`:

```
video=HDMI-A-1:1920x440M@60
```

If the panel is mounted rotated, rotate the output in the desktop's Screen Configuration tool rather
than rotating the browser: a rotated browser window still reports the unrotated viewport, and the
layout keys off viewport size.

## 6. Kiosk

Run as your desktop user, **without sudo**:

```bash
bash scripts/install-kiosk.sh && sudo reboot
```

Raspberry Pi OS logs in automatically and runs labwc on Wayland. The script installs
`~/.local/bin/desk-kiosk` and makes it the whole of `~/.config/labwc/autostart`, so the Pi boots
straight into the panel. The launcher waits for the controller's health endpoint so a cold boot
does not open on an error page, and restarts Chromium if it ever exits.

Why not a systemd user service: on this desktop `graphical-session.target` is never activated, so a
unit waiting on it silently never starts, and there is no X display for `DISPLAY=:0` to reach. That
was the first design and it would have shown a blank desktop with no error.

Replacing the autostart also drops the taskbar, desktop background and screen blanking, none of
which belong on a kiosk. Your previous autostart is kept, and this undoes it:

```bash
bash scripts/install-kiosk.sh --remove
```

The launcher opens the UI with `?kiosk`, which hides the pointer — labwc draws one even on a
touch-only panel, and X11 tools like `unclutter` do nothing on Wayland.

On Pi OS Lite with no desktop, run `cage -- chromium --kiosk http://127.0.0.1:7420/?kiosk` instead.

## Operating it

|           |                                               |
| --------- | --------------------------------------------- |
| Logs      | `journalctl -u desk-controller -f`            |
| Restart   | `sudo systemctl restart desk-controller`      |
| Config    | `/etc/desk-control.env`                       |
| Desk data | `/var/lib/desk-control/desk-config.json`      |
| Update    | `git pull && sudo bash scripts/install-pi.sh` |

`desk-config.json` holds your layout, names, wiring and presets. It is the only thing worth backing
up; everything else is re-discovered from agents on each boot.

## Fail passive, on real hardware

Pulling the Pi's power changes nothing about the desk. Monitors keep showing whatever they were
showing, the USB switch keeps whichever port it had, and every machine stays usable exactly as if
this system did not exist. That is the point of the controller being a control plane: it is not in
any path that matters, so its absence is not felt.

The consequence worth remembering: on boot the controller does **not** re-apply the last desired
state. It would otherwise move your monitors underneath you every time the Pi restarts.

## The USB switch

See [usb-switch-wiring.md](usb-switch-wiring.md) for the full build.

In short: the switch has no software interface, so the Pi presses its remote's buttons electrically
through an optocoupler — which is what `driverBinding: 'controller'` means. With a four-button remote
each port has its own pin, so there is no position to track and nothing to desync.

The switch still cannot report which port it is on, so give each peripheral its USB id and let the
agents say which machine can see it. That turns ownership from an assumption about a button press
into a reading of the actual outcome.
