import type { DeskSnapshot } from '@desk-control/domain';
import { Chip, ListRow, SectionLabel, Sheet, Stack } from '../design/index.js';
import { displayNameOf } from '../lib/desk.js';
import { platformIcon } from './icons.js';

/** Read-only system detail. Everything shown comes from the live snapshot. */
export function SystemSheet({
  snapshot,
  onClose,
}: {
  snapshot: DeskSnapshot;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={snapshot.controller.name}
      subtitle={`Controller ${snapshot.controller.version} · protocol v${snapshot.controller.protocolVersion}`}
      onClose={onClose}
      footer={
        <>
          <span>Snapshot revision {snapshot.revision}</span>
          <span>
            Local-first: this panel needs no internet connection, and losing the controller leaves
            the desk exactly as it is.
          </span>
        </>
      }
    >
      <Stack>
        <SectionLabel>Agents</SectionLabel>
        {snapshot.agents.length === 0 ? (
          <ListRow title="No agents have registered" hideChevron />
        ) : null}
        {snapshot.agents.map((agent) => {
          const computer = snapshot.computers.find(
            (candidate) => candidate.id === agent.computerId,
          );
          const online = agent.connectivity.state === 'online';
          return (
            <ListRow
              key={agent.id}
              icon={platformIcon(agent.platform)}
              title={computer ? displayNameOf(computer) : agent.id}
              subtitle={`${agent.providerKind} · agent ${agent.agentVersion}${
                agent.connectivity.detail ? ` · ${agent.connectivity.detail}` : ''
              }`}
              trailing={
                <Chip tone={online ? 'ok' : 'warn'}>
                  {online ? 'Online' : agent.connectivity.state}
                </Chip>
              }
              hideChevron
            />
          );
        })}

        <SectionLabel>Displays</SectionLabel>
        {snapshot.monitors.map((monitor) => (
          <ListRow
            key={monitor.id}
            title={displayNameOf(monitor)}
            subtitle={`${monitor.identity.manufacturerId} ${monitor.identity.model}${
              monitor.identity.serial ? ` · ${monitor.identity.serial}` : ' · no serial'
            }`}
            trailing={monitor.identity.weakIdentity ? <Chip tone="warn">Weak id</Chip> : undefined}
            hideChevron
          />
        ))}
      </Stack>
    </Sheet>
  );
}
