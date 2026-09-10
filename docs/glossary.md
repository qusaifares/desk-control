# Glossary

This project sits across displays, USB, networking and the web, which is a lot of vocabulary to hold
at once. Roughly ordered by how often each one comes up here.

## Displays

**DDC/CI** — Display Data Channel / Command Interface. A side-channel that already exists inside a
DisplayPort or HDMI cable, letting a computer talk to the _monitor_: "what inputs do you have",
"switch to HDMI 2", "set brightness 40". This is the mechanism the whole project runs on, and it is
why no extra hardware sits in the video path.

**VCP** — Virtual Control Panel. The numbered settings DDC exposes. `0x60` is input source, `0x10`
brightness, `0xD6` power. Values are not fully standard: two monitors on this desk advertise
different `0xD6` states, which is why capabilities are read rather than assumed.

**EDID** — Extended Display Identification Data. A block of data every monitor reports about itself:
manufacturer, model, serial, physical size. Used as a monitor's permanent identity, because unlike an
OS display index it never changes.

**MCCS** — Monitor Control Command Set. The specification that defines the VCP codes.

**Capabilities string** — A monitor's own description of which VCP codes and values it supports,
fetched over DDC. The only authority on which inputs a panel actually has.

## Peripherals

**HID** — Human Interface Device. The USB class covering keyboards and mice. "Never in the HID path"
means this system never touches your actual keystrokes or mouse movement.

**KM switch** — Keyboard-Mouse switch. Moves shared peripherals between computers without touching
video, which is what this desk wants: video stays on its own cable.

**KVM switch** — Keyboard-Video-Mouse. The same idea but it switches video too, which would put it in
the video path. Deliberately not used here.

**vendor:product** — A USB device's identity, as two four-digit hex numbers (`046d:c52b`). How the
controller recognises a shared keyboard: whichever computer enumerates that id currently holds it.

## Raspberry Pi and hardware

**GPIO** — General Purpose Input/Output. The row of 40 pins on a Pi, most of which software can
switch on and off. Used here to press a switch's remote button electrically: a pin drives a small
part that closes the button's contacts, so "switch to the MacBook" becomes a pulse on a wire.

**Optocoupler** — A small chip that lets one circuit switch another without them being electrically
connected, using a tiny LED and light sensor inside. Keeps the Pi and the switch safely isolated.

**Relay** — A mechanical switch flipped by an electromagnet. Does the same job as an optocoupler,
audibly, and handles larger loads.

**BCM pin number** — Which numbering scheme you mean when you say "pin 17". BCM numbers are the chip's
own, and are what `pinctrl` and most documentation use — as opposed to counting physical positions
along the header.

**DSI** — Display Serial Interface. The flat ribbon connector a Pi screen can plug into, as opposed to
HDMI.

**KMS** — Kernel Mode Setting. The Linux layer that sets screen resolution. It matters here only
because 1920×440 is an unusual mode that may need forcing.

## Networking and software

**mDNS** — multicast DNS. How devices find each other on a local network without you typing IP
addresses; the reason `deskpi.local` works. Interface exists here; not yet implemented.

**WoL** — Wake-on-LAN. Waking a powered-off computer by sending it a network packet. Not built yet.

**SPA** — Single Page Application. The web UI is one page that rewrites itself rather than loading new
pages, which is why the controller serves `index.html` for any non-API route.

**Zod** — The library used to validate anything arriving over a socket, an HTTP body, or from disk.
Schemas here are the source of truth; the TypeScript types are derived from them.

## Concepts specific to this project

**Control plane / data plane** — The control plane carries instructions ("switch to HDMI 2"); the data
plane carries the actual payload — pixels and keystrokes. This system is strictly control plane, which
is why it cannot slow your games down.

**Desired vs observed** — What you asked for, versus what agents report the hardware is actually
doing. Kept separate, never merged: the interesting states live in the gap between them.

**Agent** — The small program running on each computer that talks DDC to the monitors it is cabled to
and reports what it sees.

**Control path** — One route to a monitor: a particular agent, over a particular cable. A monitor
plugged into three computers has three, and the controller picks whichever can currently reach it.

**Evidence** — Where an observation came from. `usb-enumeration` is a computer reporting a device it
can genuinely see; `switch-report` is hardware describing itself; `unknown` means neither was
available, and is reported rather than filled in with a guess.
