import type { DeskSnapshot } from '@desk-control/domain';
import { ListRow, Panel } from '../design/index.js';
import { displayNameOf } from '../lib/desk.js';
import { GridIcon, presetIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  onApply: (presetId: string) => void;
}

export function PresetRail({ snapshot, onApply }: Props) {
  const activeId = snapshot.desired.activePresetId;

  return (
    <Panel title="Presets" plain>
      {snapshot.presets.length === 0 ? (
        <ListRow
          icon={<GridIcon />}
          title="No presets yet"
          subtitle="Add them to the desk config"
          hideChevron
        />
      ) : null}

      {snapshot.presets.map((preset) => (
        <ListRow
          key={preset.id}
          icon={presetIcon(preset.icon)}
          title={displayNameOf(preset)}
          subtitle={preset.description ?? undefined}
          selected={activeId === preset.id}
          onClick={() => onApply(preset.id)}
        />
      ))}

      {/*
       * Not a preset - an indicator. The desk is in some state of its own, and
       * saying so is more useful than showing nothing selected.
       */}
      <ListRow
        icon={<GridIcon />}
        title="Custom"
        subtitle="Current configuration"
        selected={activeId === null}
        hideChevron
        hint="The desk does not currently match a saved preset."
      />
    </Panel>
  );
}
