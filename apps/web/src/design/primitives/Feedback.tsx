import type { ReactNode } from 'react';
import { AlertCircleIcon } from '../../components/icons.js';

/** Inline error banner. One treatment, used wherever an action can fail. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="ds-notice" role="alert">
      <AlertCircleIcon size={18} />
      {children}
    </p>
  );
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-empty">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className="ds-stack">{children}</div>;
}
