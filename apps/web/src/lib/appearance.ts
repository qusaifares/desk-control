import type { Connector, Platform, SyncStatus } from '@desk-control/domain';

/**
 * Visual identity for the desk map.
 *
 * A monitor tile shows a coloured panel standing in for its source machine. It
 * is deliberately an *abstract* identity treatment - a platform-tinted gradient
 * and a logo watermark - and never a screen preview: this system does not touch
 * the video path and must not imply that it does.
 */
/**
 * Each machine gets its own hue, picked deterministically from its stable id so
 * it never changes between sessions. Platform decides the *icon*, not the
 * colour: two Windows machines on one desk have to be tellable apart at a
 * glance, which is the whole job of this treatment.
 */
/*
 * Hues deliberately avoid the red/amber/green bands: those carry status meaning
 * elsewhere in the UI, and a machine that happens to be "green" next to a green
 * health dot muddies both.
 */
const MACHINE_HUES = [212, 258, 288, 322, 190, 168];

function hashOf(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function machineHue(computerId: string): number {
  return MACHINE_HUES[hashOf(computerId) % MACHINE_HUES.length] ?? MACHINE_HUES[0]!;
}

const NEUTRAL_SCREEN = 'linear-gradient(155deg, #1b2129 0%, #2f3945 48%, #161b21 100%)';

export function screenStyle(
  computer: { id: string; platform: Platform } | undefined,
  dimmed: boolean,
): React.CSSProperties {
  if (!computer) {
    return { background: NEUTRAL_SCREEN, filter: 'saturate(0.2) brightness(0.7)' };
  }
  const hue = machineHue(computer.id);
  return {
    background: `linear-gradient(155deg,
      hsl(${hue} 62% 22%) 0%,
      hsl(${hue + 12} 68% 42%) 46%,
      hsl(${hue - 14} 60% 16%) 100%)`,
    filter: dimmed ? 'saturate(0.4) brightness(0.6)' : undefined,
  };
}

/** Connector colours, so the cable type is readable at a glance. */
export const CONNECTOR_COLORS: Record<Connector, string> = {
  DisplayPort: '#3fd77a',
  'mini-DisplayPort': '#3fd77a',
  HDMI: '#48b4f0',
  'USB-C': '#a78bfa',
  Thunderbolt: '#a78bfa',
  DVI: '#f0a92c',
  VGA: '#f0a92c',
  unknown: '#7c8899',
};

export const STATUS_TONE: Record<SyncStatus, 'ok' | 'busy' | 'warn' | 'bad' | 'idle'> = {
  'in-sync': 'ok',
  switching: 'busy',
  drifted: 'warn',
  unreachable: 'warn',
  failed: 'bad',
  unknown: 'idle',
};

/** "27\" Landscape" - size only when the panel actually reported one. */
export function describeMonitorFormat(
  physicalSizeInches: number | null,
  orientation: string | undefined,
): string {
  const shape = orientation?.startsWith('portrait') ? 'Portrait' : 'Landscape';
  if (physicalSizeInches === null) return shape;
  return `${Math.round(physicalSizeInches)}" ${shape}`;
}
