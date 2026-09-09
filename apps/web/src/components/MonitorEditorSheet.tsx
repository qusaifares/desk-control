import type { DeskSnapshot, Monitor, Platform } from '@desk-control/domain';
import { useState } from 'react';
import { Chip, ListRow, Sheet, Stack, TextField, Tile, TileGrid } from '../design/index.js';
import { CONNECTOR_COLORS } from '../lib/appearance.js';
import { computerById, displayNameOf } from '../lib/desk.js';
import { MonitorIcon, platformIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  monitor: Monitor;
  onRename: (customName: string | null) => void;
  onSetWiring: (inputId: string, computerId: string | null) => void;
  onDeclareComputer: (name: string, platform: Platform, inputId: string) => void;
  onClose: () => void;
}

const PLATFORMS: Array<{ platform: Platform; label: string }> = [
  { platform: 'windows', label: 'Windows' },
  { platform: 'macos', label: 'macOS' },
  { platform: 'linux', label: 'Linux' },
  { platform: 'unknown', label: 'Other' },
];

/**
 * Editing a monitor: what to call it, and what is plugged into each input.
 *
 * The wiring half is the important one. Discovery can only report inputs an
 * agent actually sits on, so on a desk where one machine runs an agent every
 * other input looks empty and nothing can be routed to it. This is where the
 * user fills that in - including for machines that will never run an agent at
 * all, like a console.
 */
export function MonitorEditorSheet({
  snapshot,
  monitor,
  onRename,
  onSetWiring,
  onDeclareComputer,
  onClose,
}: Props) {
  const [pickingInputId, setPickingInputId] = useState<string | null>(null);
  const [addingForInputId, setAddingForInputId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  if (addingForInputId) {
    return (
      <Sheet
        title="Add a machine"
        subtitle="For a source that will never run an agent — a console, or a laptop you have not installed anything on."
        onClose={() => setAddingForInputId(null)}
      >
        <Stack>
          <TextField
            label="Name"
            value={newName}
            placeholder="PlayStation 5"
            submitLabel="Next"
            onSubmit={(value) => setNewName(value)}
          />
          {newName.trim() ? (
            <>
              <span className="ds-field-label">Platform</span>
              <TileGrid>
                {PLATFORMS.map((entry) => (
                  <Tile
                    key={entry.platform}
                    icon={platformIcon(entry.platform, 22)}
                    label={entry.label}
                    onClick={() => {
                      onDeclareComputer(newName.trim(), entry.platform, addingForInputId);
                      setNewName('');
                      setAddingForInputId(null);
                      setPickingInputId(null);
                    }}
                  />
                ))}
              </TileGrid>
            </>
          ) : null}
        </Stack>
      </Sheet>
    );
  }

  if (pickingInputId) {
    const input = monitor.inputs.find((candidate) => candidate.id === pickingInputId);
    return (
      <Sheet
        title={input ? displayNameOf(input) : 'Input'}
        subtitle={`What is plugged into this input on ${displayNameOf(monitor)}?`}
        onClose={() => setPickingInputId(null)}
      >
        <Stack>
          {snapshot.computers.map((computer) => (
            <ListRow
              key={computer.id}
              icon={platformIcon(computer.platform)}
              title={displayNameOf(computer)}
              subtitle={
                computer.metadata.declaredByUser === 'true'
                  ? 'Added by you'
                  : 'Reported by an agent'
              }
              selected={input?.connectedComputerId === computer.id}
              onClick={() => {
                onSetWiring(pickingInputId, computer.id);
                setPickingInputId(null);
              }}
            />
          ))}
          <ListRow
            icon={<MonitorIcon />}
            title="Nothing"
            subtitle="Leave this input unassigned"
            selected={input?.connectedComputerId === null}
            onClick={() => {
              onSetWiring(pickingInputId, null);
              setPickingInputId(null);
            }}
          />
          <ListRow
            icon={<MonitorIcon />}
            title="Add a machine…"
            subtitle="A source with no agent"
            onClick={() => setAddingForInputId(pickingInputId)}
          />
        </Stack>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={`Edit ${displayNameOf(monitor)}`}
      subtitle={[
        `${monitor.identity.manufacturerId} ${monitor.identity.model}`,
        monitor.identity.serial,
      ]
        .filter(Boolean)
        .join(' · ')}
      onClose={onClose}
      footer={
        <span>
          Names and wiring are yours and are saved to the desk config. The monitor&apos;s identity
          comes from its EDID and never changes.
        </span>
      }
    >
      <Stack>
        <TextField
          label="Display name"
          value={monitor.customName ?? ''}
          placeholder={monitor.detectedName}
          hint={`Clearing this falls back to “${monitor.detectedName}”.`}
          onSubmit={(value) => onRename(value)}
          {...(monitor.customName ? { onClear: () => onRename(null), clearLabel: 'Clear' } : {})}
        />

        <span className="ds-field-label">Inputs</span>
        {monitor.inputs.map((input) => {
          const computer = computerById(snapshot, input.connectedComputerId);
          const override = snapshot.layout ? undefined : undefined;
          void override;
          return (
            <ListRow
              key={input.id}
              icon={<MonitorIcon />}
              title={displayNameOf(input)}
              subtitle={computer ? displayNameOf(computer) : 'Not assigned'}
              trailing={
                <Chip tone={computer ? 'ok' : 'idle'}>
                  <span
                    className="ds-dot"
                    style={{ background: CONNECTOR_COLORS[input.connector] }}
                  />
                  {input.connector}
                </Chip>
              }
              onClick={() => setPickingInputId(input.id)}
            />
          );
        })}
      </Stack>
    </Sheet>
  );
}
