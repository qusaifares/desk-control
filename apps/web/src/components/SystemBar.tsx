import type { DeskSnapshot } from '@desk-control/domain';
import type { ConnectionState } from '../lib/api.js';
import { agentForComputer, displayNameOf } from '../lib/desk.js';

interface Props {
  snapshot: DeskSnapshot | null;
  connection: ConnectionState;
}

/**
 * Connectivity is first-class, not a toast. When an agent goes away the desk
 * keeps working - the UI just says it can no longer see that machine.
 */
export function SystemBar({ snapshot, connection }: Props) {
  return (
    <header className="system-bar">
      <div className="system-identity">
        <span className="system-title">{snapshot?.controller.name ?? 'Desk Control'}</span>
        <span className={`chip chip-connection-${connection}`}>
          {connection === 'connected' ? 'Controller online' : `Controller ${connection}`}
        </span>
      </div>

      <div className="computer-strip">
        {(snapshot?.computers ?? []).map((computer) => {
          const agent = agentForComputer(snapshot!, computer.id);
          const state = agent?.connectivity.state ?? computer.connectivity.state;
          return (
            <span
              key={computer.id}
              className={`computer-pill state-${state}`}
              title={
                agent
                  ? `${agent.providerKind} agent · ${state}${agent.connectivity.detail ? ` · ${agent.connectivity.detail}` : ''}`
                  : 'No agent has ever registered for this computer'
              }
            >
              <span className={`dot dot-${state}`} />
              {displayNameOf(computer)}
            </span>
          );
        })}
      </div>
    </header>
  );
}
