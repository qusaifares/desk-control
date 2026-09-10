import type { DeskSnapshot, Peripheral } from '@desk-control/domain';
import { Chip, Panel, StatusDot, Tile, TileGrid } from '../design/index.js';
import { STATUS_TONE } from '../lib/appearance.js';
import { computerById, displayNameOf, STATUS_LABELS } from '../lib/desk.js';
import { computerIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  onSetOwner: (peripheralId: string, computerId: string) => void;
}

interface Group {
  key: string;
  label: string;
  peripherals: Peripheral[];
  switchId: string;
}

/**
 * Peripherals are grouped by the switch channel that moves them.
 *
 * A single-channel USB switch carries the keyboard and mouse together, so the
 * UI offers one control for both rather than pretending they can be routed
 * independently.
 */
function groupPeripherals(snapshot: DeskSnapshot): Group[] {
  const groups = new Map<string, Group>();

  for (const peripheral of snapshot.peripherals) {
    const peripheralSwitch = snapshot.peripheralSwitches.find(
      (candidate) => candidate.id === peripheral.switchId,
    );
    const channelId = peripheral.channelId ?? peripheralSwitch?.channels[0] ?? 'default';
    const key = `${peripheral.switchId}:${channelId}`;
    const existing = groups.get(key);
    if (existing) existing.peripherals.push(peripheral);
    else {
      groups.set(key, {
        key,
        label: '',
        peripherals: [peripheral],
        switchId: peripheral.switchId,
      });
    }
  }

  for (const group of groups.values()) {
    // Label by kind rather than by name: "Keyboard + Mouse" reads better as a
    // section heading than whatever the devices happen to be called.
    const kinds = [...new Set(group.peripherals.map((peripheral) => peripheral.kind))];
    group.label = kinds.map((kind) => kind[0]!.toUpperCase() + kind.slice(1)).join(' + ');
  }
  return [...groups.values()];
}

export function PeripheralPanel({ snapshot, onSetOwner }: Props) {
  const groups = groupPeripherals(snapshot);
  if (groups.length === 0) return null;

  return (
    <>
      {groups.map((group) => {
        const first = group.peripherals[0]!;
        const resolution = snapshot.resolutions.peripherals[first.id];
        const status = resolution?.status ?? 'unknown';
        const ownerId = resolution?.observedOwnerComputerId ?? null;
        const desiredId = resolution?.desiredOwnerComputerId ?? null;

        const peripheralSwitch = snapshot.peripheralSwitches.find(
          (candidate) => candidate.id === group.switchId,
        );
        const candidates = (peripheralSwitch?.ports ?? [])
          .map((port) => computerById(snapshot, port.computerId))
          .filter((computer): computer is NonNullable<typeof computer> => computer !== undefined);

        return (
          <Panel
            key={group.key}
            title={group.label}
            action={
              status === 'in-sync' ? undefined : (
                <Chip tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Chip>
              )
            }
          >
            <TileGrid>
              {candidates.map((computer) => {
                const isOwner = ownerId === computer.id;
                const isRequested = !isOwner && desiredId === computer.id;
                return (
                  <Tile
                    key={computer.id}
                    icon={computerIcon(computer, 22)}
                    label={displayNameOf(computer)}
                    selected={isOwner}
                    marker={
                      isOwner ? (
                        <StatusDot tone="ok" label="Currently owns these peripherals" />
                      ) : isRequested ? (
                        <StatusDot tone="busy" pulsing label="Requested" />
                      ) : undefined
                    }
                    onClick={() => onSetOwner(first.id, computer.id)}
                  />
                );
              })}
            </TileGrid>
          </Panel>
        );
      })}
    </>
  );
}
