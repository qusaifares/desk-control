import type { ProviderOperationResult } from './monitor-control-provider.js';
import type {
  ObservedSwitchState,
  PeripheralSwitchProvider,
  SetPortRequest,
} from './peripheral-switch-provider.js';

/**
 * Routes each switch to whichever provider drives it.
 *
 * A desk can mix them - a real GPIO-driven switch beside a simulated one while
 * you are still wiring things up - and the controller above should not care.
 */
export class CompositePeripheralSwitchProvider implements PeripheralSwitchProvider {
  readonly kind = 'composite';

  constructor(private readonly providers: Map<string, PeripheralSwitchProvider>) {}

  async discoverSwitches(): Promise<string[]> {
    return [...this.providers.keys()];
  }

  async getObservedState(): Promise<ObservedSwitchState[]> {
    const states: ObservedSwitchState[] = [];
    for (const provider of new Set(this.providers.values())) {
      states.push(...(await provider.getObservedState()));
    }
    return states;
  }

  async setPort(request: SetPortRequest): Promise<ProviderOperationResult> {
    const provider = this.providers.get(request.switchId);
    if (!provider) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_TARGET',
          message: `No driver configured for ${request.switchId}`,
          retryable: false,
        },
      };
    }
    return provider.setPort(request);
  }

  async dispose(): Promise<void> {
    for (const provider of new Set(this.providers.values())) await provider.dispose?.();
  }
}
