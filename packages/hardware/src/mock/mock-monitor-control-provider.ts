import type { MonitorCapability } from '@desk-control/domain';
import type { MonitorReport, ObservedMonitorReport } from '@desk-control/protocol';
import type {
  MonitorControlProvider,
  ProviderOperationResult,
  SetBrightnessRequest,
  SetInputRequest,
  SetPowerRequest,
} from '../monitor-control-provider.js';
import type { SimulatedDesk } from './simulated-desk.js';

/**
 * A MonitorControlProvider backed by SimulatedDesk.
 *
 * It is scoped to one simulated computer, so it only sees monitors that machine
 * is actually cabled to - and it loses DDC reachability when its input is not
 * the live one, just like real hardware.
 */
export class MockMonitorControlProvider implements MonitorControlProvider {
  readonly kind = 'mock';

  constructor(
    private readonly desk: SimulatedDesk,
    private readonly computerId: string,
  ) {}

  async discoverMonitors(): Promise<MonitorReport[]> {
    return this.desk.wiredTo(this.computerId).map((monitor) => {
      const ownInput = monitor.inputs.find(
        (input) => input.connectedComputerId === this.computerId,
      );
      return {
        stableId: monitor.stableId,
        localHandle: `mock:${this.computerId}:${monitor.stableId}`,
        detectedName: monitor.detectedName,
        identity: {
          manufacturerId: monitor.manufacturerId,
          model: monitor.model,
          serial: monitor.serial,
          manufactureYear: monitor.manufactureYear,
          weakIdentity: monitor.serial === null,
          physicalSizeInches: monitor.physicalSizeInches ?? null,
        },
        capabilities: monitor.capabilities,
        inputs: monitor.inputs.map((input) => ({
          id: input.id,
          connector: input.connector,
          ddcInputSourceValue: input.ddcInputSourceValue,
          detectedName: input.detectedName,
          maxMode: input.maxMode,
        })),
        connectedViaInputId: ownInput?.id ?? null,
        requiresActiveInput: monitor.requiresActiveInput,
        preferredInputId: monitor.preferredInputId,
      } satisfies MonitorReport;
    });
  }

  async getCapabilities(stableId: string): Promise<MonitorCapability[]> {
    return this.desk.get(stableId)?.capabilities ?? [];
  }

  async getObservedState(): Promise<ObservedMonitorReport[]> {
    return this.desk.wiredTo(this.computerId).map((monitor) => {
      const reachable = this.desk.canControl(monitor.stableId, this.computerId);
      if (!reachable) {
        return {
          stableId: monitor.stableId,
          activeInputId: null,
          powerState: 'unknown',
          brightness: null,
          reachability: 'unreachable',
          error: {
            code: 'DEVICE_UNREACHABLE',
            message:
              monitor.fault?.mode === 'unreachable'
                ? monitor.fault.message
                : 'DDC only answers on the active input',
          },
        } satisfies ObservedMonitorReport;
      }
      return {
        stableId: monitor.stableId,
        activeInputId: monitor.activeInputId,
        powerState: monitor.currentPowerState,
        brightness: monitor.capabilities.includes('brightness') ? monitor.currentBrightness : null,
        reachability: 'reachable',
        error: null,
      } satisfies ObservedMonitorReport;
    });
  }

  async setBrightness(request: SetBrightnessRequest): Promise<ProviderOperationResult> {
    if (!this.desk.canControl(request.stableId, this.computerId)) {
      return {
        ok: false,
        error: { code: 'DEVICE_UNREACHABLE', message: 'No DDC access right now', retryable: true },
      };
    }
    const outcome = this.desk.setBrightness(request.stableId, request.brightness);
    return outcome.error ? { ok: false, error: outcome.error } : { ok: true };
  }

  async setPower(request: SetPowerRequest): Promise<ProviderOperationResult> {
    if (!this.desk.canControl(request.stableId, this.computerId)) {
      return {
        ok: false,
        error: { code: 'DEVICE_UNREACHABLE', message: 'No DDC access right now', retryable: true },
      };
    }
    const outcome = this.desk.setPowerState(request.stableId, request.powerState);
    return outcome.error ? { ok: false, error: outcome.error } : { ok: true };
  }

  async setInput(request: SetInputRequest): Promise<ProviderOperationResult> {
    if (!this.desk.canControl(request.stableId, this.computerId)) {
      return {
        ok: false,
        error: {
          code: 'DEVICE_UNREACHABLE',
          message: `${this.computerId} cannot reach ${request.stableId} over DDC right now`,
          retryable: true,
        },
      };
    }
    const outcome = await this.desk.switchInput({
      stableId: request.stableId,
      inputId: request.inputId,
      commandId: request.commandId,
      timeoutMs: request.timeoutMs,
    });
    return outcome.error ? { ok: false, error: outcome.error } : { ok: true };
  }
}
