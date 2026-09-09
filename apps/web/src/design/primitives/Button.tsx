import type { ReactNode } from 'react';

export function Button({
  children,
  variant = 'default',
  onClick,
  disabled,
}: {
  children: ReactNode;
  variant?: 'default' | 'primary';
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ds-button"
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="ds-icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
