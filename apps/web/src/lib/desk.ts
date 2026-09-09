import type { Computer, DeskSnapshot, Monitor, SyncStatus } from '@desk-control/domain';

export function displayNameOf(entity: {
  detectedName: string;
  customName?: string | null;
}): string {
  return entity.customName ?? entity.detectedName;
}

export function computerById(snapshot: DeskSnapshot, id: string | null): Computer | undefined {
  if (!id) return undefined;
  return snapshot.computers.find((computer) => computer.id === id);
}

/** Computers physically cabled to this monitor - the only valid sources. */
export function sourcesForMonitor(snapshot: DeskSnapshot, monitor: Monitor): Computer[] {
  return monitor.inputs
    .map((input) => input.connectedComputerId)
    .filter((id): id is string => id !== null)
    .map((id) => computerById(snapshot, id))
    .filter((computer): computer is Computer => computer !== undefined);
}

export const STATUS_LABELS: Record<SyncStatus, string> = {
  'in-sync': 'Live',
  switching: 'Switching',
  failed: 'Failed',
  unreachable: 'Unreachable',
  drifted: 'Changed at the panel',
  unknown: 'Unknown',
};

export function agentForComputer(snapshot: DeskSnapshot, computerId: string) {
  return snapshot.agents.find((agent) => agent.computerId === computerId);
}
