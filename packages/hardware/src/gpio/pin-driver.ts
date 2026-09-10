import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Momentarily closes a GPIO pin, the way a finger closes a button.
 *
 * The only operation needed to drive a KM switch: these switches have no
 * software interface at all, so the Pi presses the remote's button
 * electrically - a pin drives an optocoupler or relay across the button's
 * contacts.
 *
 * Shelling out to a CLI rather than binding libgpiod keeps the agent free of
 * native modules, which is the same trade made for DDC. A press happens once
 * every few seconds at most, so process startup is not worth optimising away.
 */
export interface GpioPinDriver {
  readonly kind: string;
  /** Drive `pin` active for `holdMs`, then release it. */
  pulse(pin: number, holdMs: number): Promise<void>;
  dispose?(): Promise<void>;
}

export class GpioPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpioPinError';
  }
}

/**
 * Raspberry Pi OS Bookworm ships `pinctrl`, which addresses pins by their
 * familiar BCM numbers and needs no chip number - one less thing to get wrong
 * between a Pi 4 and a Pi 5, where the chip index moved.
 */
export class PinctrlGpioPinDriver implements GpioPinDriver {
  readonly kind = 'pinctrl';

  constructor(private readonly binary = 'pinctrl') {}

  async pulse(pin: number, holdMs: number): Promise<void> {
    try {
      await run(this.binary, ['set', String(pin), 'op', 'dh']);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    } finally {
      // Always release, even if the hold threw: a pin left driven would hold
      // the button down forever.
      await run(this.binary, ['set', String(pin), 'op', 'dl']).catch(() => {});
    }
  }
}

/** libgpiod, for a Pi OS that predates `pinctrl` or a non-Pi board. */
export class GpiodPinDriver implements GpioPinDriver {
  readonly kind = 'gpiod';

  constructor(
    private readonly chip = 'gpiochip0',
    private readonly binary = 'gpioset',
  ) {}

  async pulse(pin: number, holdMs: number): Promise<void> {
    // gpioset holds the line only while it runs, so the hold is the command.
    await run(this.binary, [
      '--mode=time',
      `--usec=${Math.max(1, Math.round(holdMs * 1000))}`,
      this.chip,
      `${pin}=1`,
    ]);
  }
}

/** Records presses instead of making them. */
export class MockGpioPinDriver implements GpioPinDriver {
  readonly kind = 'mock';
  readonly pulses: Array<{ pin: number; holdMs: number }> = [];
  failOnPin: number | null = null;

  async pulse(pin: number, holdMs: number): Promise<void> {
    if (this.failOnPin === pin) throw new GpioPinError(`pin ${pin} is not wired`);
    this.pulses.push({ pin, holdMs });
  }
}
