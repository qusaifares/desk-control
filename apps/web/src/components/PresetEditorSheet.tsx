import type { DeskSnapshot, Preset } from '@desk-control/domain';
import { ListRow, Sheet, Stack, TextField } from '../design/index.js';
import { computerById, displayNameOf } from '../lib/desk.js';
import { MonitorIcon, platformIcon, PowerIcon, SunIcon } from './icons.js';

interface Props {
  snapshot: DeskSnapshot;
  preset: Preset;
  onRename: (customName: string | null) => void;
  onCaptureCurrent: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Editing one preset.
 *
 * A preset is data, so there is nothing here but its name and the assignments
 * it holds. "Update to the current desk" re-captures what is on screen rather
 * than offering a form to hand-edit every assignment - the desk itself is a far
 * better editor than a list of dropdowns.
 */
export function PresetEditorSheet({
  snapshot,
  preset,
  onRename,
  onCaptureCurrent,
  onDelete,
  onClose,
}: Props) {
  const monitorEntries = Object.entries(preset.assignments.monitorSources);
  const peripheralEntries = Object.entries(preset.assignments.peripheralOwners);

  return (
    <Sheet
      title={`Edit ${displayNameOf(preset)}`}
      subtitle={preset.id}
      onClose={onClose}
      footer={
        <span>
          Presets are plain data in the desk config. Applying one goes through exactly the same
          command path as moving a single display by hand.
        </span>
      }
    >
      <Stack>
        <TextField
          label="Name"
          value={preset.customName ?? ''}
          placeholder={preset.detectedName}
          hint={`Clearing this falls back to “${preset.detectedName}”.`}
          onSubmit={(value) => onRename(value)}
          {...(preset.customName ? { onClear: () => onRename(null), clearLabel: 'Clear' } : {})}
        />

        <ListRow
          icon={<SunIcon />}
          title="Update to the current desk"
          subtitle="Replace what this preset holds with what is on screen now"
          onClick={onCaptureCurrent}
        />

        <span className="ds-field-label">
          This preset sets {monitorEntries.length} display
          {monitorEntries.length === 1 ? '' : 's'}
          {peripheralEntries.length > 0
            ? ` and ${peripheralEntries.length} peripheral${peripheralEntries.length === 1 ? '' : 's'}`
            : ''}
        </span>

        {monitorEntries.map(([monitorId, computerId]) => {
          const monitor = snapshot.monitors.find((candidate) => candidate.id === monitorId);
          const computer = computerById(snapshot, computerId);
          return (
            <ListRow
              key={monitorId}
              icon={<MonitorIcon />}
              title={monitor ? displayNameOf(monitor) : monitorId}
              subtitle={computer ? displayNameOf(computer) : computerId}
              // A preset written for a desk you no longer have is not an error;
              // applying it simply skips what is missing.
              hint={monitor ? undefined : 'This display is not on the desk right now'}
              hideChevron
            />
          );
        })}

        {peripheralEntries.map(([peripheralId, computerId]) => {
          const peripheral = snapshot.peripherals.find(
            (candidate) => candidate.id === peripheralId,
          );
          const computer = computerById(snapshot, computerId);
          return (
            <ListRow
              key={peripheralId}
              icon={computer ? platformIcon(computer.platform) : <MonitorIcon />}
              title={peripheral ? displayNameOf(peripheral) : peripheralId}
              subtitle={computer ? displayNameOf(computer) : computerId}
              hideChevron
            />
          );
        })}

        <ListRow
          icon={<PowerIcon />}
          title="Delete this preset"
          subtitle="Removes it from the desk config"
          onClick={onDelete}
        />
      </Stack>
    </Sheet>
  );
}
