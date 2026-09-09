import { aggregateStatus, type DeskSnapshot } from '@desk-control/domain';
import type { Tone } from '../design/index.js';
import type { ConnectionState } from '../lib/api.js';
import { AlertCircleIcon, CheckCircleIcon, LinkIcon, SpinnerIcon } from './icons.js';

/**
 * One honest sentence about the desk, derived from the same resolutions the
 * monitor tiles use so the two can never disagree.
 */
function summarise(snapshot: DeskSnapshot): { tone: Tone; label: string } {
  const statuses = Object.values(snapshot.resolutions.monitors).map(
    (resolution) => resolution.status,
  );
  const offlineAgents = snapshot.agents.filter(
    (agent) => agent.connectivity.state !== 'online',
  ).length;

  switch (aggregateStatus(statuses)) {
    case 'switching': {
      const count = statuses.filter((status) => status === 'switching').length;
      return { tone: 'busy', label: `Switching ${count} display${count === 1 ? '' : 's'}` };
    }
    case 'failed':
      return {
        tone: 'bad',
        label: `${statuses.filter((s) => s === 'failed').length} display change failed`,
      };
    case 'unreachable':
      return { tone: 'warn', label: 'Some displays cannot be reached' };
    case 'drifted':
      return { tone: 'warn', label: 'A display was changed at the panel' };
    case 'in-sync':
      return offlineAgents > 0
        ? { tone: 'warn', label: `Desk unchanged · ${offlineAgents} agent offline` }
        : { tone: 'ok', label: 'All systems ready' };
    default:
      return { tone: 'idle', label: 'Waiting for hardware' };
  }
}

export function StatusFooter({
  snapshot,
  connection,
}: {
  snapshot: DeskSnapshot;
  connection: ConnectionState;
}) {
  const summary = summarise(snapshot);
  const online = snapshot.agents.filter((agent) => agent.connectivity.state === 'online').length;

  const icon =
    summary.tone === 'ok' ? (
      <CheckCircleIcon />
    ) : summary.tone === 'busy' ? (
      <SpinnerIcon />
    ) : (
      <AlertCircleIcon />
    );

  return (
    <footer className="desk-footer">
      <span className="desk-footer-item" data-tone={summary.tone}>
        {icon}
        {summary.label}
      </span>
      <span
        className="desk-footer-item"
        data-tone={connection === 'connected' ? undefined : 'warn'}
      >
        <LinkIcon />
        {connection === 'connected'
          ? `${online} device${online === 1 ? '' : 's'} connected`
          : `Controller ${connection}`}
      </span>
    </footer>
  );
}
