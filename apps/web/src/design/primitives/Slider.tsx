import { useEffect, useState } from 'react';

interface SliderProps {
  label: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  /** Text shown instead of a value when there is nothing to show. */
  emptyLabel?: string;
  /** Fired on release, not on every pixel of travel. */
  onCommit: (value: number) => void;
}

/**
 * A value slider that commits on release.
 *
 * Deliberately not on every change event: each commit is a real DDC write to a
 * monitor, and firing one per pixel of travel would flood a bus that is slow
 * and gets unreliable when hammered. The number under the thumb tracks the
 * finger; the hardware is only asked once you let go.
 */
export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  disabled,
  emptyLabel = 'unknown',
  onCommit,
}: SliderProps) {
  const [draft, setDraft] = useState(value ?? min);
  const [dragging, setDragging] = useState(false);

  // Follow the hardware unless the user is actively moving the control.
  useEffect(() => {
    if (!dragging && value !== null) setDraft(value);
  }, [value, dragging]);

  const commit = () => {
    setDragging(false);
    onCommit(draft);
  };

  return (
    <div className="ds-slider">
      <div className="ds-slider-head">
        <span className="ds-field-label">{label}</span>
        <span className="ds-slider-value">
          {value === null && !dragging ? emptyLabel : `${draft}${unit}`}
        </span>
      </div>
      <input
        type="range"
        className="ds-slider-input"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          setDragging(true);
          setDraft(Number(event.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => dragging && commit()}
      />
    </div>
  );
}
