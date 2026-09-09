import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { agentForComputer, computerById, displayNameOf, sourcesForMonitor } from '../lib/desk.js';

interface Props {
  snapshot: DeskSnapshot;
  monitor: Monitor;
  onPick: (computerId: string) => void;
  onClose: () => void;
  error: string | null;
}

/**
 * Only computers physically wired to this monitor are offered. The list comes
 * from discovered wiring, not from a hardcoded desk.
 */
export function SourcePicker({ snapshot, monitor, onPick, onClose, error }: Props) {
  const sources = sourcesForMonitor(snapshot, monitor);
  const resolution = snapshot.resolutions.monitors[monitor.id];
  const observedId = resolution?.observedSourceComputerId ?? null;
  const desiredId = resolution?.desiredSourceComputerId ?? null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-label={`Choose a source for ${displayNameOf(monitor)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-header">
          <div>
            <h2>{displayNameOf(monitor)}</h2>
            <p className="sheet-subtitle">
              {monitor.identity.manufacturerId} {monitor.identity.model}
              {monitor.identity.serial ? ` · ${monitor.identity.serial}` : ''}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>

        {error ? <p className="sheet-error">{error}</p> : null}

        <ul className="source-list">
          {sources.map((computer) => {
            const input = monitor.inputs.find((i) => i.connectedComputerId === computer.id);
            const agent = agentForComputer(snapshot, computer.id);
            const isLive = computer.id === observedId;
            const isRequested = computer.id === desiredId && !isLive;
            return (
              <li key={computer.id}>
                <button
                  type="button"
                  className={`source-option${isLive ? ' is-live' : ''}`}
                  onClick={() => onPick(computer.id)}
                >
                  <span className="source-name">{displayNameOf(computer)}</span>
                  <span className="source-meta">
                    {input ? `${input.connector} · ${displayNameOf(input)}` : 'unwired'}
                    {input?.maxMode
                      ? ` · ${input.maxMode.width}×${input.maxMode.height} @ ${input.maxMode.refreshHz}Hz${input.maxMode.vrr ? ' VRR' : ''}`
                      : ''}
                  </span>
                  <span className="source-flags">
                    {isLive ? <span className="chip chip-in-sync">Live</span> : null}
                    {isRequested ? <span className="chip chip-switching">Requested</span> : null}
                    <span
                      className={`dot dot-${agent?.connectivity.state ?? computer.connectivity.state}`}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="sheet-footer">
          <p>
            Capabilities: {monitor.capabilities.join(', ') || 'none reported'}
            {' · '}
            Control paths:{' '}
            {monitor.controlPaths
              .map((path) => {
                const computer = computerById(snapshot, path.computerId);
                return computer ? displayNameOf(computer) : path.computerId;
              })
              .join(', ') || 'none'}
          </p>
        </footer>
      </div>
    </div>
  );
}
