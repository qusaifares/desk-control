import type { DeskSnapshot } from '@desk-control/domain';
import { ListRow, Panel } from '../design/index.js';
import { MoonIcon, PowerIcon, SunIcon } from './icons.js';

/**
 * Display power is real; computer power is not.
 *
 * Waking or suspending a *computer* needs Wake-on-LAN and an OS-level sleep
 * path that the agent protocol does not have, so that row stays disabled with
 * the reason attached rather than hidden or wired to a no-op. The capabilities
 * the desk reports are real - the missing piece is ours, and saying so is more
 * honest than a button that quietly does nothing.
 */
export function QuickActions({
  snapshot,
  onSetAllDisplaysPower,
}: {
  snapshot: DeskSnapshot;
  onSetAllDisplaysPower: (powerState: 'on' | 'standby' | 'off') => void;
}) {
  const powerCapable = snapshot.monitors.filter((monitor) =>
    monitor.capabilities.includes('power'),
  );
  const anySleep = snapshot.computers.some((computer) => computer.capabilities.includes('sleep'));

  const displaysHint =
    powerCapable.length === 0
      ? 'No display on this desk reports power control.'
      : `${powerCapable.length} of ${snapshot.monitors.length} displays support this.`;

  return (
    <Panel title="Quick actions" plain>
      <ListRow
        icon={<MoonIcon />}
        title="Displays off"
        subtitle={`Power down ${powerCapable.length} display${powerCapable.length === 1 ? '' : 's'}`}
        disabled={powerCapable.length === 0}
        onClick={() => onSetAllDisplaysPower('off')}
        hint={displaysHint}
      />
      <ListRow
        icon={<SunIcon />}
        title="Displays on"
        subtitle="Wake every display back up"
        disabled={powerCapable.length === 0}
        onClick={() => onSetAllDisplaysPower('on')}
        hint={displaysHint}
      />
      <ListRow
        icon={<PowerIcon />}
        title="Sleep PCs"
        subtitle="Suspend every computer"
        disabled
        onClick={() => {}}
        hint={
          anySleep
            ? 'Not implemented yet: suspending a computer is not part of the agent protocol.'
            : 'No computer on this desk reports this capability.'
        }
      />
    </Panel>
  );
}
