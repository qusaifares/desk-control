import type { ReactNode } from 'react';
import { ChevronIcon } from '../../components/icons.js';

interface ListRowProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  /** Shown before the chevron: a chip, a dot, anything small. */
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Hides the chevron for rows that are indicators rather than navigation. */
  hideChevron?: boolean;
  /** Omit to render a static row instead of a button. */
  onClick?: () => void;
  /** Explains a disabled row. Also used as the accessible description. */
  title_?: string;
  hint?: string;
}

/**
 * A full-width row with an icon, a title and an optional subtitle.
 *
 * This is the workhorse: presets, quick actions, source choices and system
 * details are all list rows, which is what keeps unrelated screens feeling like
 * one product.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  selected,
  disabled,
  hideChevron,
  onClick,
  hint,
}: ListRowProps) {
  const content = (
    <>
      {icon ? <span className="ds-row-icon">{icon}</span> : null}
      <span className="ds-row-text">
        <span className="ds-row-title">{title}</span>
        {subtitle ? <span className="ds-row-subtitle">{subtitle}</span> : null}
      </span>
      <span className="ds-row-trailing">
        {trailing}
        {onClick && !hideChevron ? <ChevronIcon size={16} /> : null}
      </span>
    </>
  );

  const className = `ds-row${selected ? ' is-selected' : ''}`;

  if (!onClick) {
    return (
      <div className={className} title={hint}>
        {content}
      </div>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled} title={hint}>
      {content}
    </button>
  );
}
