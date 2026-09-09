import type { ReactNode } from 'react';

/**
 * The page skeleton: header, a three-column body, footer.
 *
 * Any new screen should use this rather than inventing a layout, so navigation
 * furniture stays in the same place. The rails collapse under the stage on
 * narrow screens, which is what the Pi touchscreen gets.
 */
export function AppShell({
  header,
  left,
  stage,
  right,
  footer,
}: {
  header: ReactNode;
  left?: ReactNode;
  stage: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="ds-shell">
      {header}
      <div className="ds-shell-body">
        {left ? <div className="ds-rail">{left}</div> : null}
        <div className="ds-stage">{stage}</div>
        {right ? <div className="ds-rail">{right}</div> : null}
      </div>
      {footer}
    </div>
  );
}
