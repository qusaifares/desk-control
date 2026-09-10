import type { ProviderOperationResult } from '../monitor-control-provider.js';
import type {
  ObservedSwitchState,
  PeripheralSwitchProvider,
  SetPortRequest,
} from '../peripheral-switch-provider.js';
import type { GpioPinDriver } from './pin-driver.js';

/**
 * How the switch's remote behaves.
 *
 * `direct`  one button per port - press the one you want.
 * `cycle`   a single button that advances to the next port.
 */
export type GpioSwitchMode = 'direct' | 'cycle';

export interface GpioSwitchConfig {
  switchId: string;
  channels: string[];
  mode: GpioSwitchMode;
  /**
   * direct: portId -> BCM pin.
   * cycle:  a single entry, whose pin advances the switch.
   */
  pins: Record<string, number>;
  /** Ports in the order the switch cycles through them. */
  portOrder: string[];
  /** How long to hold the button closed. */
  pulseMs?: number;
  /** How long the switch needs between presses. */
  settleMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drives a USB/KM switch by pressing its remote through a GPIO pin.
 *
 * Switches of this class have no software interface and, crucially, no way to
 * report which port they are on. So this provider deliberately does *not*
 * pretend to know: `getObservedState` returns unknown, and real ownership comes
 * from asking the computers which of them enumerates the shared keyboard.
 *
 * That is also why a cycling remote needs to be told where the switch currently
 * is. Counting presses and trusting the count would desync silently the first
 * time a press was missed, and stay wrong forever.
 */
export class GpioPeripheralSwitchProvider implements PeripheralSwitchProvider {
  readonly kind = 'gpio';

  private readonly pulseMs: number;
  private readonly settleMs: number;
  private readonly completedCommands = new Map<string, ProviderOperationResult>();

  constructor(
    private readonly config: GpioSwitchConfig,
    private readonly pins: GpioPinDriver,
  ) {
    this.pulseMs = config.pulseMs ?? 150;
    this.settleMs = config.settleMs ?? 350;
  }

  async discoverSwitches(): Promise<string[]> {
    return [this.config.switchId];
  }

  /**
   * Always unknown, and that is the honest answer: nothing about this hardware
   * can be read back. Ownership is established by USB enumeration on the
   * computers instead.
   */
  async getObservedState(): Promise<ObservedSwitchState[]> {
    return [
      {
        switchId: this.config.switchId,
        activePorts: Object.fromEntries(this.config.channels.map((channel) => [channel, null])),
        reachability: 'unknown',
        error: null,
      },
    ];
  }

  async setPort(request: SetPortRequest): Promise<ProviderOperationResult> {
    const cached = this.completedCommands.get(request.commandId);
    if (cached) return cached;

    if (!this.config.portOrder.includes(request.portId)) {
      return this.fail('UNKNOWN_TARGET', `Switch has no port ${request.portId}`, false);
    }

    const presses = this.pressesFor(request);
    if ('error' in presses) return presses.error;

    try {
      for (let index = 0; index < presses.pin.length; index += 1) {
        if (index > 0) await sleep(this.settleMs);
        await this.pins.pulse(presses.pin[index]!, this.pulseMs);
      }
    } catch (error) {
      return this.fail('DEVICE_UNREACHABLE', (error as Error).message, true);
    }

    // Deliberately not reporting where the switch landed: this provider cannot
    // know. The controller confirms the move from USB evidence.
    const result: ProviderOperationResult = { ok: true };
    this.completedCommands.set(request.commandId, result);
    return result;
  }

  /** The sequence of pin presses needed, or why we will not press anything. */
  private pressesFor(
    request: SetPortRequest,
  ): { pin: number[] } | { error: ProviderOperationResult } {
    if (this.config.mode === 'direct') {
      const pin = this.config.pins[request.portId];
      if (pin === undefined) {
        return {
          error: this.fail('UNKNOWN_TARGET', `No GPIO pin mapped for ${request.portId}`, false),
        };
      }
      return { pin: [pin] };
    }

    const cyclePin = Object.values(this.config.pins)[0];
    if (cyclePin === undefined) {
      return { error: this.fail('UNKNOWN_TARGET', 'No GPIO pin configured', false) };
    }

    if (!request.currentPortId) {
      return {
        error: this.fail(
          'DEVICE_UNREACHABLE',
          'This switch can only cycle, so it cannot be moved without knowing which port it is on. ' +
            'Give at least one computer an agent that reports USB devices.',
          true,
        ),
      };
    }

    const from = this.config.portOrder.indexOf(request.currentPortId);
    const to = this.config.portOrder.indexOf(request.portId);
    if (from === -1) {
      return {
        error: this.fail('UNKNOWN_TARGET', `Unknown current port ${request.currentPortId}`, false),
      };
    }

    const steps = (to - from + this.config.portOrder.length) % this.config.portOrder.length;
    return { pin: Array.from({ length: steps }, () => cyclePin) };
  }

  private fail(code: string, message: string, retryable: boolean): ProviderOperationResult {
    return { ok: false, error: { code, message, retryable } };
  }

  async dispose(): Promise<void> {
    await this.pins.dispose?.();
  }
}
