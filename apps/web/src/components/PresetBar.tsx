import type { DeskSnapshot } from '@desk-control/domain';
import { displayNameOf } from '../lib/desk.js';

interface Props {
  snapshot: DeskSnapshot;
  onApply: (presetId: string) => void;
}

export function PresetBar({ snapshot, onApply }: Props) {
  if (snapshot.presets.length === 0) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">Presets</h2>
      <div className="preset-row">
        {snapshot.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-button${snapshot.desired.activePresetId === preset.id ? ' is-active' : ''}`}
            onClick={() => onApply(preset.id)}
            title={preset.description ?? undefined}
          >
            {displayNameOf(preset)}
          </button>
        ))}
      </div>
    </section>
  );
}
