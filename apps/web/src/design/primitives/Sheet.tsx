import { useEffect, type ReactNode } from 'react';
import { Button } from './Button.js';

interface SheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/** The one modal treatment. Closes on backdrop click and on Escape. */
export function Sheet({ title, subtitle, onClose, footer, children }: SheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="ds-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="ds-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ds-sheet-header">
          <div>
            <div className="ds-sheet-title">{title}</div>
            {subtitle ? <div className="ds-sheet-subtitle">{subtitle}</div> : null}
          </div>
          <Button onClick={onClose}>Close</Button>
        </header>
        {children}
        {footer ? <footer className="ds-sheet-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
