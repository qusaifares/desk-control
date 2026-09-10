import type { ReactNode } from 'react';
import { AlertCircleIcon, CheckCircleIcon } from '../../components/icons.js';
import type { Tone } from './types.js';

/**
 * Inline banner. One treatment for anything the app needs to say back.
 *
 * Takes a tone because not everything worth saying is a failure: a preset that
 * saved three displays and skipped one is a warning, and colouring it like an
 * error would overstate it.
 */
export function Notice({ tone = 'bad', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <p className="ds-notice" data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
      {tone === 'ok' ? <CheckCircleIcon size={18} /> : <AlertCircleIcon size={18} />}
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
