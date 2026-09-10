/**
 * Presses a GPIO pin, so you can prove the wiring works before asking the
 * controller to rely on it.
 *
 * Run it on the Pi:
 *   pnpm gpio:test 17            press pin 17 once
 *   pnpm gpio:test 17 27 22 23   press each in turn, two seconds apart
 *
 * It drives the same code path the controller uses, so a pin that works here
 * works there. Nothing about the desk config is involved.
 */
import { PinctrlGpioPinDriver, GpiodPinDriver } from '../packages/hardware/src/index.js';

const args = process.argv.slice(2);
const useGpiod = args.includes('--gpiod');
const pins = args.filter((arg) => /^\d+$/.test(arg)).map(Number);

if (pins.length === 0) {
  console.error('Usage: pnpm gpio:test <bcm-pin> [more pins...] [--gpiod]');
  console.error('Pin numbers are BCM, the same ones pinctrl uses.');
  process.exit(1);
}

const driver = useGpiod ? new GpiodPinDriver() : new PinctrlGpioPinDriver();
console.log(`Using the ${driver.kind} driver.\n`);

for (const [index, pin] of pins.entries()) {
  if (index > 0) {
    console.log('   waiting 2s so you can see which port the switch lands on...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  process.stdout.write(`pressing pin ${pin} for 150ms ... `);
  try {
    await driver.pulse(pin, 150);
    console.log('done');
  } catch (error) {
    console.log('FAILED');
    console.error(`  ${(error as Error).message}`);
    console.error('  Is pinctrl installed, and are you in the gpio group?');
    process.exit(2);
  }
}

console.log(`
If the switch changed port each time, the wiring is good. Put those pin numbers
into the switch's "control" block in desk-config.json - see docs/usb-switch-wiring.md.

If nothing happened, the pin is not reaching the button contacts. If the switch
changed but to the wrong port, swap the pin numbers around rather than rewiring.
`);
