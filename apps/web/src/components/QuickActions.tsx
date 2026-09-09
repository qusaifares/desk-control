import type { DeskSnapshot } from '@desk-control/domain';
import { ListRow, Panel } from '../design/index.js';
import { MoonIcon, PowerIcon, SunIcon } from './icons.js';

/**
 * Power actions.
 *
 * These are shown but deliberately inert: display power, wake and sleep are not
 * in the protocol yet, so there is no command path behind them. They are
 * rendered disabled with the reason attached rather than hidden, because the
 * capabilities the desk *reports* are real - the gap is ours, and stating it is
 * more honest than a button that quietly does nothing.
 */
const NOT_IMPLEMENTED = 'Not implemented yet: power commands are not part of the agent protocol.';

export function QuickActions({ snapshot }: { snapshot: DeskSnapshot }) {
  const anyMonitorPower = snapshot.monitors.some((monitor) =>
    monitor.capabilities.includes('power'),
  );
  const anyWake = snapshot.computers.some((computer) =>
    computer.capabilities.includes('wake-on-lan'),
  );
  const anySleep = snapshot.computers.some((computer) => computer.capabilities.includes('sleep'));

  const reason = (supported: boolean) =>
    supported ? NOT_IMPLEMENTED : 'No device on this desk reports this capability.';

  return (
    <Panel title="Quick actions" plain>
      <ListRow
        icon={<MoonIcon />}
        title="Display off"
        subtitle="Standby every monitor"
        disabled
        onClick={() => {}}
        hint={reason(anyMonitorPower)}
      />
      <ListRow
        icon={<SunIcon />}
        title="Wake all"
        subtitle="Wake-on-LAN every computer"
        disabled
        onClick={() => {}}
        hint={reason(anyWake)}
      />
      <ListRow
        icon={<PowerIcon />}
        title="Sleep PCs"
        subtitle="Suspend every computer"
        disabled
        onClick={() => {}}
        hint={reason(anySleep)}
      />
    </Panel>
  );
}
