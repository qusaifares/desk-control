import type { ReactNode } from 'react';

/** Small uppercase heading used to title a panel or a group. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="ds-section-label">{children}</h2>;
}
