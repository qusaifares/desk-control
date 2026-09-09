import type { ReactNode } from 'react';
import { SectionLabel } from './SectionLabel.js';

interface PanelProps {
  /** Rendered as the section label above the content. */
  title?: string;
  /** Optional control shown opposite the title. */
  action?: ReactNode;
  /** Drops the surface and border, keeping only the spacing rhythm. */
  plain?: boolean;
  className?: string;
  children: ReactNode;
}

/** The standard grouping container. Every rail section is one of these. */
export function Panel({ title, action, plain, className, children }: PanelProps) {
  return (
    <section
      className={`ds-panel${plain ? ' ds-panel-plain' : ''}${className ? ` ${className}` : ''}`}
    >
      {title || action ? (
        <header className="ds-panel-header">
          {title ? <SectionLabel>{title}</SectionLabel> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
