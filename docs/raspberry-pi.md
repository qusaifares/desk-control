# Running the panel on a Raspberry Pi

The Pi is the **control plane host**. It runs the controller, serves the web UI, and — once the USB
switch is wired to its GPIO — drives peripheral switching. It never carries video, and it never
carries keyboard or mouse data.

It does **not** run an agent: it has no monitors of its own to control. The desk's displays are
driven over DDC/CI by agents on the computers that are cabled to them.

## What you need

- A Raspberry Pi 4 or 5 (ARM64), power supply, SD card
- Raspberry Pi OS **Bookworm** or newer, 64-bit
- The panel, on HDMI or DSI
- Node 20+

## 1. Flash the card

Use Raspberry Pi Imager and set the hostname, your user, Wi-Fi and SSH in the imager's advanced
options before writing — it saves a keyboard-and-monitor round trip. `deskpi.local` is a reasonable
hostname.

## 2. Install Node

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
```

## 3. Install the controller

```bash
git clone git@github.com:qusaifares/desk-control.git && cd desk-control
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
DESK_CONTROL_URL=ws://deskpi.local:7420/agent DESK_CONTROL_PAIRING_TOKEN=<token> node apps/agent/dist/index.js
```

Its monitors should appear on the panel within a few seconds.

## 5. The display

The panel is a 1920×440 strip, which is not a mode most drivers offer by default. On Bookworm, KMS
takes the mode from the kernel command line — append to the single line in
`/boot/firmware/cmdline.txt`:

```
video=HDMI-A-1:1920x440M@60
```

Check what the panel actually reports before forcing anything:

```bash
kmsprint 2>/dev/null || modetest -c 2>/dev/null | head -40
```

If the panel is mounted rotated, rotate the compositor rather than the browser — a rotated browser
window still reports the unrotated viewport, and the layout keys off viewport size. On labwc, set
`output` rotation in `~/.config/labwc/rc.xml`; on Wayfire, `transform` in `~/.config/wayfire.ini`.

## 6. Kiosk

```bash
mkdir -p ~/.config/systemd/user && cp deploy/desk-kiosk.service ~/.config/systemd/user/
```

```bash
systemctl --user enable --now desk-kiosk
```

It waits for the controller's health endpoint before launching, so a cold boot does not flash an
error page. On Pi OS Lite with no desktop, run `cage -- chromium-browser --kiosk --app=http://127.0.0.1:7420/`
instead.

Blank the cursor and stop the screen sleeping:

```bash
sudo apt install -y unclutter && echo 'unclutter -idle 0 &' >> ~/.config/labwc/autostart
```

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

Not wired up yet. A KM switch of this class has no software interface — control is the front button
and the wired remote — so the Pi will drive it by closing the remote's contacts through a GPIO pin
and an optocoupler, which is what `driverBinding: 'controller'` in the desk config means.

The open question is whether the remote selects ports directly or cycles through them. Cycling gives
no way to know which port is live, and this system does not guess: the answer is to have each agent
report whether the shared keyboard and mouse are currently enumerated on its machine, so observed
ownership comes from the computers rather than from a counter we maintain.
