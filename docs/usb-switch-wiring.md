# Wiring the USB switch to the Pi

For a KM switch whose remote has **four buttons**, one per computer. This is the easy case: each
button is independent, so the Pi presses the one you want and there is no position to track.

## Why any of this is necessary

The switch has no software interface — no serial port, no USB command set, no network. The only way
in is the buttons. A button is two metal contacts that touch when pressed, so the Pi presses them
electrically instead of with a finger.

You never connect a Pi pin straight to the button. A small part sits between them so the two devices
are electrically isolated and neither can damage the other.

## What to buy

| Part                                      | Notes                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **4-channel optocoupler board**           | About £4. Search "4 channel optocoupler module 3.3V". Prefer optocouplers over relays: silent, faster, no moving parts. |
| **Dupont jumper wires**, female-to-female | To reach the Pi's pins without soldering to the Pi itself.                                                              |
| **Thin wire**, ~24 AWG                    | Two per button, to the remote.                                                                                          |
| **Soldering iron**                        | Unavoidable: the button contacts are small.                                                                             |
| **Multimeter**                            | Optional but saves guesswork — see below.                                                                               |

Make sure the board says **3.3 V** compatible. The Pi's pins are 3.3 V and are not 5 V tolerant.

## Step 1 — open the remote and find the contacts

Each button is a tiny tactile switch with contacts on the board underneath. Pressing it connects two
of them.

With a multimeter in continuity mode, put a probe on each side of a button and press it — it beeps
when you have the right pair. Do that for all four.

**Check whether the buttons share a common line.** Very often one side of all four buttons is joined
together. If so you need five wires total (one common, four signals) instead of eight, and the wiring
is much tidier.

## Step 2 — solder

Two wires per button, or one common plus four if they share. Take them out through the cable exit or
a small notch so the case still closes.

Keep the wires long enough to reach the Pi comfortably. Strain-relieve them — hot glue or tape inside
the case — because a wire that tears off a pad takes the pad with it.

## Step 3 — connect to the Pi

Each optocoupler channel has an input side (from the Pi) and an output side (to the button).

**Pi → board input:**

| Board | Pi                      |
| ----- | ----------------------- |
| VCC   | 3.3 V (physical pin 1)  |
| GND   | Ground (physical pin 6) |
| IN1   | GPIO 17                 |
| IN2   | GPIO 27                 |
| IN3   | GPIO 22                 |
| IN4   | GPIO 23                 |

**Board output → remote:** each channel's two output terminals go across one button's contacts, in
parallel with the button. The button still works by hand — you are adding a second way to press it,
not replacing it.

Those four GPIO numbers are only a suggestion; any free pins work. They are BCM numbers, which is
what `pinctrl` and the config use — not the physical position on the header.

## Step 4 — test before trusting it

```bash
pnpm gpio:test 17
```

The switch should change port. Then all four in sequence, two seconds apart:

```bash
pnpm gpio:test 17 27 22 23
```

Watch which computer gets the keyboard each time and note the order — that is the mapping you write
into the config.

If nothing happens, the signal is not reaching the contacts. If the wrong port activates, swap the
numbers in the config rather than rewiring.

## Step 5 — tell the controller

In `/var/lib/desk-control/desk-config.json`, on the switch:

```jsonc
"control": {
  "kind": "gpio",
  "mode": "direct",
  "pins": { "port-1": 17, "port-2": 27, "port-3": 22, "port-4": 23 },
  "pulseMs": 150,
  "settleMs": 350,
  "driver": "pinctrl"
}
```

`pins` maps _your_ port ids to the pins that activate them. Restart with
`sudo systemctl restart desk-controller`.

## Step 6 — make ownership visible

The switch cannot report which port it is on, so switching will work while the panel still shows the
keyboard's location as **unknown**. To fix that, give each peripheral its USB id so agents can report
which machine currently sees it:

```bash
pnpm --filter @desk-control/agent exec tsx src/index.ts probe
```

Or list USB ids directly on Windows:

```powershell
Get-CimInstance Win32_PnPEntity -Filter "DeviceID LIKE 'USB%'" | ForEach-Object { if ($_.DeviceID -match 'VID_(....)&PID_(....)') { "$($matches[1]):$($matches[2])".ToLower() } } | Sort-Object -Unique
```

Unplug the keyboard and run it again to see which id disappears — that is the one. Put it on the
peripheral:

```jsonc
{ "id": "peripheral:keyboard-main", "kind": "keyboard", "usbId": "1532:0243", ... }
```

Ownership then comes from whichever computer enumerates it, which is a real reading rather than an
assumption about whether the button press worked.

## If something goes wrong

**Permission denied on the pin.** Add yourself to the `gpio` group and log back in:
`sudo usermod -aG gpio $USER`

**`pinctrl: command not found`.** Older Pi OS. Install `gpiod` and set `"driver": "gpiod"` in the
config, adding `"chip": "gpiochip4"` on a Pi 5.

**The switch changes port twice.** `pulseMs` is too long for it; try 80.

**Nothing at all, and the multimeter says the contacts are right.** Some boards are active-low —
their input triggers when pulled to ground, not to 3.3 V. Check the board's documentation; you may
need an inverting channel or a different module.

## What this does not do

Only the keyboard and mouse move. Video stays on its own cables, switched separately over DDC/CI, and
nothing about this puts the Pi between a computer and a display — or between the keyboard and
whatever you are typing into.
