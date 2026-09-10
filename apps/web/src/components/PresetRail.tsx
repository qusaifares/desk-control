import type { DeskSnapshot, Preset } from '@desk-control/domain';
import { useState } from 'react';
import { ListRow, Panel, Sheet, Stack, TextField } from '../design/index.js';
import { displayNameOf } from '../lib/desk.js';
import { GridIcon, presetIcon, SunIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  editing: boolean;
  onApply: (presetId: string) => void;
  onEdit: (preset: Preset) => void;
  onCreate: (name: string) => void;
}

export function PresetRail({ snapshot, editing, onApply, onEdit, onCreate }: Props) {
  const activeId = snapshot.desired.activePresetId;
  const [naming, setNaming] = useState(false);

  return (
    <>
      <Panel title="Presets" plain>
        {snapshot.presets.length === 0 && !editing ? (
          <ListRow
            icon={<GridIcon />}
            title="No presets yet"
            subtitle="Use Edit desk to save one"
            hideChevron
          />
        ) : null}

        {snapshot.presets.map((preset) => (
          <ListRow
            key={preset.id}
            icon={presetIcon(preset.icon)}
            title={displayNameOf(preset)}
            subtitle={preset.description ?? undefined}
            selected={!editing && activeId === preset.id}
            onClick={() => (editing ? onEdit(preset) : onApply(preset.id))}
          />
        ))}

        {editing ? (
          <ListRow
            icon={<SunIcon />}
            title="Save current desk…"
            subtitle="Capture what is on screen as a new preset"
            onClick={() => setNaming(true)}
          />
        ) : (
          /*
           * Not a preset - an indicator. The desk is in some state of its own,
           * and saying so is more useful than showing nothing selected.
           */
          <ListRow
            icon={<GridIcon />}
            title="Custom"
            subtitle="Current configuration"
            selected={activeId === null}
            hideChevron
            hint="The desk does not currently match a saved preset."
          />
        )}
      </Panel>

      {naming ? (
        <Sheet
          title="Save current desk"
          subtitle="Captures what each display is actually showing right now. Anything that cannot be read is left out."
          onClose={() => setNaming(false)}
        >
          <Stack>
            <TextField
              label="Preset name"
              value=""
              placeholder="Work"
              submitLabel="Save"
              onSubmit={(value) => {
                onCreate(value);
                setNaming(false);
              }}
            />
          </Stack>
        </Sheet>
      ) : null}
    </>
  );
}
