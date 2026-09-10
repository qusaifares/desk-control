import type { DeskSnapshot, Monitor } from '@desk-control/domain';
import { Chip, ListRow, Sheet, Slider, StatusDot, Stack } from '../design/index.js';
import { CONNECTOR_COLORS } from '../lib/appearance.js';
import { agentForComputer, computerById, displayNameOf, sourcesForMonitor } from '../lib/desk.js';
import { computerIcon, MoonIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  monitor: Monitor;
  onPick: (computerId: string) => void;
  onSetBrightness: (brightness: number) => void;
  onSetPower: (powerState: 'on' | 'standby' | 'off') => void;
  onClose: () => void;
}

/**
 * Only computers physically wired to this monitor are offered — the list comes
 * from discovered wiring, not from a hardcoded desk.
 */
export function SourcePicker({
  snapshot,
  monitor,
  onPick,
  onSetBrightness,
  onSetPower,
  onClose,
}: Props) {
  const sources = sourcesForMonitor(snapshot, monitor);
  const resolution = snapshot.resolutions.monitors[monitor.id];
  const observedId = resolution?.observedSourceComputerId ?? null;
  const desiredId = resolution?.desiredSourceComputerId ?? null;
  // Read from the panel, not from whatever was last requested.
  const observedBrightness = snapshot.observed.monitors[monitor.id]?.brightness ?? null;

  const subtitle = [
    `${monitor.identity.manufacturerId} ${monitor.identity.model}`,
    monitor.identity.serial,
    monitor.identity.physicalSizeInches
      ? `${Math.round(monitor.identity.physicalSizeInches)}"`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet
      title={displayNameOf(monitor)}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <span>Capabilities: {monitor.capabilities.join(', ') || 'none reported'}</span>
          <span>
            Control paths:{' '}
            {monitor.controlPaths
              .map((path) => {
                const computer = computerById(snapshot, path.computerId);
                return computer ? displayNameOf(computer) : path.computerId;
              })
              .join(', ') || 'none'}
          </span>
        </>
      }
    >
      <Stack>
        {monitor.capabilities.includes('brightness') ? (
          <Slider
            label="Brightness"
            unit="%"
            value={observedBrightness}
            emptyLabel="not read yet"
            onCommit={onSetBrightness}
          />
        ) : null}

        {monitor.capabilities.includes('power') ? (
          <ListRow
            icon={<MoonIcon />}
            title="Turn this display off"
            subtitle="It stays off until something wakes it"
            onClick={() => onSetPower('off')}
          />
        ) : null}

        {sources.length === 0 ? (
          <ListRow title="Nothing is wired to this monitor yet" hideChevron />
        ) : null}

        {sources.map((computer) => {
          const input = monitor.inputs.find(
            (candidate) => candidate.connectedComputerId === computer.id,
          );
          const agent = agentForComputer(snapshot, computer.id);
          const state = agent?.connectivity.state ?? computer.connectivity.state;
          const isLive = computer.id === observedId;
          const isRequested = !isLive && computer.id === desiredId;

          const detail = [
            input ? `${input.connector} · ${displayNameOf(input)}` : 'not wired',
            input?.maxMode
              ? `${input.maxMode.width}×${input.maxMode.height} @ ${input.maxMode.refreshHz}Hz${
                  input.maxMode.vrr ? ' VRR' : ''
                }`
              : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <ListRow
              key={computer.id}
              icon={computerIcon(computer)}
              title={displayNameOf(computer)}
              subtitle={detail}
              selected={isLive}
              onClick={() => onPick(computer.id)}
              trailing={
                <>
                  {isLive ? <Chip tone="ok">Live</Chip> : null}
                  {isRequested ? <Chip tone="busy">Requested</Chip> : null}
                  {input ? <StatusDot color={CONNECTOR_COLORS[input.connector]} /> : null}
                  <StatusDot
                    tone={state === 'online' ? 'ok' : state === 'offline' ? 'bad' : 'idle'}
                    label={`Agent ${state}`}
                  />
                </>
              }
            />
          );
        })}
      </Stack>
    </Sheet>
  );
}
