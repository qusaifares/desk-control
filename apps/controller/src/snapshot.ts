import {
  resolveMonitorState,
  resolvePeripheralState,
  type ControllerInfo,
  type DeskSnapshot,
} from '@desk-control/domain';
import type { DeskStore } from './desk-store.js';

/**
 * Builds the payload every UI client renders.
 *
 * Resolutions (in-sync / switching / failed / drifted / unreachable) are
 * computed here, once, so a browser, a phone and the Pi touchscreen can never
 * disagree about what the desk is doing.
 */
export function buildSnapshot(store: DeskStore, controller: ControllerInfo): DeskSnapshot {
  const observedMonitors = store.observedMonitors();
  const observedPeripherals = store.observedPeripherals();
  const monitors = [...store.monitors.values()];

  const monitorResolutions: DeskSnapshot['resolutions']['monitors'] = {};
  for (const monitor of monitors) {
    const desired = store.desired.monitorSources[monitor.id];
    const command = desired?.commandId ? store.commands.get(desired.commandId) : undefined;
    const resolution = resolveMonitorState({
      desired,
      observed: observedMonitors[monitor.id],
      command,
    });
    monitorResolutions[monitor.id] = {
      status: resolution.status,
      inFlightCommandId: resolution.inFlightCommandId,
      error: resolution.error,
      desiredSourceComputerId: resolution.desiredSourceComputerId,
      observedSourceComputerId: resolution.observedSourceComputerId,
      lastKnownSourceComputerId: store.lastKnownSourceComputerId(monitor.id),
    };
  }

  const peripheralResolutions: DeskSnapshot['resolutions']['peripherals'] = {};
  for (const peripheral of store.config.peripherals) {
    const desired = store.desired.peripheralOwners[peripheral.id];
    const command = desired?.commandId ? store.commands.get(desired.commandId) : undefined;
    const resolution = resolvePeripheralState({
      desired,
      observed: observedPeripherals[peripheral.id],
      command,
    });
    peripheralResolutions[peripheral.id] = {
      status: resolution.status,
      inFlightCommandId: resolution.inFlightCommandId,
      error: resolution.error,
      desiredOwnerComputerId: resolution.desiredOwnerComputerId,
      observedOwnerComputerId: resolution.observedOwnerComputerId,
    };
  }

  return {
    revision: store.revision,
    updatedAt: new Date().toISOString(),
    controller,
    layout: store.config.layout,
    computers: [...store.computers.values()],
    agents: [...store.agents.values()],
    monitors,
    peripherals: store.config.peripherals,
    peripheralSwitches: store.config.peripheralSwitches,
    presets: [...store.config.presets].sort((a, b) => a.sortOrder - b.sortOrder),
    desired: store.desired,
    observed: { monitors: observedMonitors, peripherals: observedPeripherals },
    commands: store.listCommands().slice(0, 40),
    resolutions: { monitors: monitorResolutions, peripherals: peripheralResolutions },
  };
}
