import type { Platform } from '@desk-control/domain';

/**
 * Inline SVG only. The Pi has no internet in normal operation, so an icon font
 * or a CDN sprite would be a dependency that fails exactly when the desk is
 * doing its job.
 */
type IconProps = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

export function WindowsIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M3 5.5 10.2 4.5V11H3V5.5Z" fill="currentColor" />
      <path d="M11.4 4.3 21 3v8h-9.6V4.3Z" fill="currentColor" />
      <path d="M3 12.4h7.2v6.5L3 17.9v-5.5Z" fill="currentColor" />
      <path d="M11.4 12.4H21V21l-9.6-1.3v-7.3Z" fill="currentColor" />
    </svg>
  );
}

export function AppleIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="M16.3 12.7c0-2 1.6-3 1.7-3.05-.9-1.35-2.35-1.53-2.86-1.55-1.22-.12-2.38.72-3 .72-.61 0-1.57-.7-2.58-.68-1.33.02-2.55.77-3.24 1.96-1.38 2.4-.35 5.96 1 7.9.66.95 1.44 2.02 2.47 1.98.99-.04 1.37-.64 2.57-.64 1.2 0 1.54.64 2.59.62 1.07-.02 1.74-.97 2.39-1.93.75-1.1 1.06-2.17 1.08-2.23-.02-.01-2.07-.8-2.09-3.1Z"
        fill="currentColor"
      />
      <path
        d="M14.4 6.5c.54-.66.91-1.57.81-2.5-.78.03-1.73.52-2.29 1.18-.5.58-.94 1.51-.82 2.4.87.07 1.76-.44 2.3-1.08Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LinuxIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="M12 2.5c-2.2 0-3.3 1.7-3.3 3.9 0 1.6.3 2.4-.4 3.6-.9 1.5-2.3 3-2.3 5 0 1.4.7 2.2 1.7 2.6.5.9 1.3 2 2.4 2.3 1.4.4 2.9.4 4.3 0 1.1-.3 1.9-1.4 2.4-2.3 1-.4 1.7-1.2 1.7-2.6 0-2-1.4-3.5-2.3-5-.7-1.2-.4-2-.4-3.6 0-2.2-1.1-3.9-3.3-3.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MonitorIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 20h6M12 16.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function BriefcaseIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.5 7V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6V7M2.5 12h19"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GamepadIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.6 3A2.6 2.6 0 0 1 16 17.6L14.6 16H9.4L8 17.6a2.6 2.6 0 0 1-4.3-1.2l-.6-3A4.5 4.5 0 0 1 7.5 8Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 11v2.2M5.9 12.1h2.2M15.5 11.4h.01M17.6 13.1h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GridIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" fill="currentColor" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" fill="currentColor" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" fill="currentColor" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" fill="currentColor" />
    </svg>
  );
}

export function GearIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.8v2.1M12 19.1v2.1M21.2 12h-2.1M4.9 12H2.8M18.5 5.5l-1.5 1.5M7 17l-1.5 1.5M18.5 18.5 17 17M7 7 5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PowerIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 3v8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7.1 6.4a7 7 0 1 0 9.8 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="m9.5 5.5 6.2 6.5-6.2 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckCircleIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m7.9 12.3 2.7 2.7 5.5-5.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlertCircleIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" fill="currentColor" opacity="0.18" />
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.6v5.1M12 16.2h.01"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SpinnerIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LinkIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path
        d="M4 9.2a12.5 12.5 0 0 1 16 0M6.9 12.6a8.2 8.2 0 0 1 10.2 0M9.8 15.9a4 4 0 0 1 4.4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="19.2" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** A computer's icon: what the user chose, else its platform. */
export function computerIcon(
  computer: { platform: Platform; appearance?: { icon: string | null } },
  size = 20,
) {
  return iconByName(computer.appearance?.icon, size) ?? platformIcon(computer.platform, size);
}

export function platformIcon(platform: Platform, size = 20) {
  switch (platform) {
    case 'windows':
      return <WindowsIcon size={size} />;
    case 'macos':
      return <AppleIcon size={size} />;
    case 'linux':
      return <LinuxIcon size={size} />;
    default:
      return <MonitorIcon size={size} />;
  }
}

/** Icons a user can choose for a computer. Ids are stored, not the markup. */
export const CHOOSABLE_ICONS = [
  'monitor',
  'windows',
  'apple',
  'linux',
  'gamepad',
  'briefcase',
  'grid',
] as const;

export function iconByName(name: string | null | undefined, size = 20) {
  switch (name) {
    case 'windows':
      return <WindowsIcon size={size} />;
    case 'apple':
      return <AppleIcon size={size} />;
    case 'linux':
      return <LinuxIcon size={size} />;
    case 'gamepad':
      return <GamepadIcon size={size} />;
    case 'briefcase':
      return <BriefcaseIcon size={size} />;
    case 'grid':
      return <GridIcon size={size} />;
    case 'monitor':
      return <MonitorIcon size={size} />;
    default:
      return null;
  }
}

/** Presets carry a free-form icon hint; unknown hints fall back sensibly. */
export function presetIcon(hint: string | null, size = 20) {
  switch (hint) {
    case 'briefcase':
      return <BriefcaseIcon size={size} />;
    case 'gamepad':
      return <GamepadIcon size={size} />;
    case 'grid':
      return <GridIcon size={size} />;
    default:
      return <MonitorIcon size={size} />;
  }
}
