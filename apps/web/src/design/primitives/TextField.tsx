import { useEffect, useState } from 'react';
import { Button } from './Button.js';

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  /** Shown under the field, e.g. what clearing falls back to. */
  hint?: string;
  submitLabel?: string;
  /** Rendered as a secondary action when the field can be emptied. */
  onClear?: () => void;
  clearLabel?: string;
  onSubmit: (value: string) => void;
}

/**
 * A labelled text input with an explicit submit.
 *
 * Explicit rather than save-on-blur: on a touchscreen, blur happens by
 * accident, and a rename that fires when you meant to scroll is worse than one
 * extra tap.
 */
export function TextField({
  label,
  value,
  placeholder,
  hint,
  submitLabel = 'Save',
  onClear,
  clearLabel = 'Reset',
  onSubmit,
}: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const dirty = draft.trim() !== value.trim();

  return (
    <label className="ds-field">
      <span className="ds-field-label">{label}</span>
      <span className="ds-field-row">
        <input
          className="ds-field-input"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && dirty && draft.trim()) onSubmit(draft.trim());
          }}
        />
        <Button
          variant="primary"
          disabled={!dirty || !draft.trim()}
          onClick={() => onSubmit(draft.trim())}
        >
          {submitLabel}
        </Button>
        {onClear ? <Button onClick={onClear}>{clearLabel}</Button> : null}
      </span>
      {hint ? <span className="ds-field-hint">{hint}</span> : null}
    </label>
  );
}
