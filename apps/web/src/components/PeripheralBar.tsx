import type { DeskSnapshot } from '@desk-control/domain';
import { computerById, displayNameOf, STATUS_LABELS } from '../lib/desk.js';

interface Props {
  snapshot: DeskSnapshot;
  onSetOwner: (peripheralId: string, computerId: string) => void;
}

/**
 * Keyboard and mouse ownership. The controller asks a hardware switch to change
 * ownership; it never carries HID data itself.
 */
export function PeripheralBar({ snapshot, onSetOwner }: Props) {
  if (snapshot.peripherals.length === 0) return null;

  return (
    <section className="panel">
      <h2 className="panel-title">Keyboard &amp; mouse</h2>
      <div className="peripheral-list">
        {snapshot.peripherals.map((peripheral) => {
          const resolution = snapshot.resolutions.peripherals[peripheral.id];
          const owner = computerById(snapshot, resolution?.observedOwnerComputerId ?? null);
          const status = resolution?.status ?? 'unknown';
          const peripheralSwitch = snapshot.peripheralSwitches.find(
            (candidate) => candidate.id === peripheral.switchId,
          );
          const options = (peripheralSwitch?.ports ?? [])
            .map((port) => computerById(snapshot, port.computerId))
            .filter((computer): computer is NonNullable<typeof computer> => computer !== undefined);

          return (
            <div key={peripheral.id} className="peripheral-row">
              <div className="peripheral-label">
                <span className="peripheral-name">{displayNameOf(peripheral)}</span>
                <span className={`chip chip-${status}`}>{STATUS_LABELS[status]}</span>
              </div>
              <div className="peripheral-options">
                {options.map((computer) => (
                  <button
                    key={computer.id}
                    type="button"
                    className={`segment${owner?.id === computer.id ? ' is-active' : ''}`}
                    onClick={() => onSetOwner(peripheral.id, computer.id)}
                  >
                    {displayNameOf(computer)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
