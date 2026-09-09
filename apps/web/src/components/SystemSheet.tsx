import type { DeskSnapshot } from '@desk-control/domain';
import { useState } from 'react';
import { Chip, ListRow, SectionLabel, Sheet, Stack, TextField } from '../design/index.js';
import { displayNameOf } from '../lib/desk.js';
import { platformIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  onRenameComputer: (computerId: string, customName: string | null) => void;
  onClose: () => void;
}

/**
 * The desk's device inventory, and the place to rename a computer.
 *
 * Renaming lives here rather than behind Edit desk because it is not
 * destructive and it is what you reach for when a machine is showing its
 * hostname. The name is stored as a `customName` in the desk config, so it
 * survives the agent restarting - and it never touches the computer's identity,
 * which stays derived from the machine itself.
 */
export function SystemSheet({ snapshot, onRenameComputer, onClose }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const renaming = renamingId
    ? snapshot.computers.find((computer) => computer.id === renamingId)
    : undefined;

  if (renaming) {
    return (
      <Sheet
        title={`Rename ${displayNameOf(renaming)}`}
        subtitle={renaming.id}
        onClose={() => setRenamingId(null)}
        footer={
          <>
            <span>
              The name is yours and is saved to the desk config. The computer&apos;s identity comes
              from the machine itself and never changes.
            </span>
            <span>Reported by its agent as “{renaming.detectedName}”.</span>
          </>
        }
      >
        <TextField
          label="Display name"
          value={renaming.customName ?? ''}
          placeholder={renaming.detectedName}
          hint={`Clearing this falls back to “${renaming.detectedName}”.`}
          onSubmit={(value) => {
            onRenameComputer(renaming.id, value);
            setRenamingId(null);
          }}
          {...(renaming.customName
            ? {
                onClear: () => {
                  onRenameComputer(renaming.id, null);
                  setRenamingId(null);
                },
                clearLabel: 'Clear',
              }
            : {})}
        />
      </Sheet>
    );
  }

  const agentFor = (computerId: string) =>
    snapshot.agents.find((agent) => agent.computerId === computerId);

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
        <SectionLabel>Computers</SectionLabel>
        {snapshot.computers.length === 0 ? (
          <ListRow
            title="No computers yet"
            subtitle="Start an agent, or add one in Edit desk"
            hideChevron
          />
        ) : null}
        {snapshot.computers.map((computer) => {
          const agent = agentFor(computer.id);
          const state = agent?.connectivity.state ?? computer.connectivity.state;
          const declared = computer.metadata.declaredByUser === 'true';

          return (
            <ListRow
              key={computer.id}
              icon={platformIcon(computer.platform)}
              title={displayNameOf(computer)}
              subtitle={
                agent
                  ? `${agent.providerKind} · agent ${agent.agentVersion}`
                  : declared
                    ? 'Added by you · no agent'
                    : 'No agent has ever registered'
              }
              trailing={
                <>
                  {/*
                   * A simulated agent is called out explicitly: mock hardware
                   * sitting alongside real hardware is otherwise impossible to
                   * tell apart, which is exactly how a simulated desk gets
                   * mistaken for a real one.
                   */}
                  {agent?.providerKind === 'mock' ? <Chip tone="warn">Simulated</Chip> : null}
                  <Chip tone={state === 'online' ? 'ok' : state === 'offline' ? 'bad' : 'idle'}>
                    {state === 'online' ? 'Online' : state}
                  </Chip>
                </>
              }
              onClick={() => setRenamingId(computer.id)}
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
            hint="Rename and arrange displays in Edit desk."
            hideChevron
          />
        ))}
      </Stack>
    </Sheet>
  );
}
