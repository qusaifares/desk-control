import { describe, expect, it } from 'vitest';
import { arrangeFromDesktop, type ArrangementEntry } from './arrangement.js';

/*
 * Captured from a real Windows desk with EnumDisplaySettings: a portrait
 * 1440p panel on the left, a 4K panel above a 1440p panel on the right, all
 * 27". The 4K panel runs at 150% scaling, which is what makes pixels useless as
 * positions on their own.
 */
const REAL_DESK: ArrangementEntry[] = [
  {
    monitorId: 'bottom-1440p',
    bounds: { x: 0, y: 0, width: 2560, height: 1440, rotation: 0 },
    physicalSizeInches: 27,
  },
  {
    monitorId: 'top-4k',
    bounds: { x: 0, y: -2160, width: 3840, height: 2160, rotation: 0 },
    physicalSizeInches: 27,
  },
  {
    monitorId: 'left-portrait',
    bounds: { x: -1440, y: -1403, width: 1440, height: 2560, rotation: 90 },
    physicalSizeInches: 27,
  },
];

const byId = (placements: ReturnType<typeof arrangeFromDesktop>) =>
  Object.fromEntries(placements.map((placement) => [placement.monitorId, placement]));

describe('arrangeFromDesktop', () => {
  it('rebuilds a portrait beside a mixed-DPI stack the way it sits on the desk', () => {
    const placed = byId(arrangeFromDesktop(REAL_DESK));
    const portrait = placed['left-portrait']!;
    const top = placed['top-4k']!;
    const bottom = placed['bottom-1440p']!;

    expect(portrait.orientation).toBe('portrait-left');
    expect(top.orientation).toBe('landscape');

    // Same size panels come out the same size, whatever their resolution, to
    // within the half-unit snap.
    expect(Math.abs(top.width - bottom.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(portrait.height - bottom.width)).toBeLessThanOrEqual(0.5);

    // The portrait is left of the stack and touching it.
    expect(portrait.x).toBe(0);
    expect(top.x).toBe(portrait.x + portrait.width);
    expect(bottom.x).toBe(top.x);

    // The stack touches: no phantom gap from the 4K panel's scaling.
    expect(bottom.y).toBe(top.y + top.height);

    // And the portrait sits roughly centred on the stack, not flush to the top.
    const stackMiddle = (top.y + bottom.y + bottom.height) / 2;
    const portraitMiddle = portrait.y + portrait.height / 2;
    expect(Math.abs(stackMiddle - portraitMiddle)).toBeLessThan(2);
  });

  it('keeps a plain side-by-side pair side by side', () => {
    const placed = byId(
      arrangeFromDesktop([
        {
          monitorId: 'right',
          bounds: { x: 1920, y: 0, width: 1920, height: 1080, rotation: 0 },
          physicalSizeInches: 24,
        },
        {
          monitorId: 'left',
          bounds: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
          physicalSizeInches: 24,
        },
      ]),
    );
    expect(placed.left!.x).toBe(0);
    expect(placed.right!.x).toBe(placed.left!.width);
    expect(placed.right!.y).toBe(placed.left!.y);
  });

  it('sizes a panel with no reported size like its neighbours rather than dropping it', () => {
    const placed = byId(
      arrangeFromDesktop([
        {
          monitorId: 'known',
          bounds: { x: 0, y: 0, width: 2560, height: 1440, rotation: 0 },
          physicalSizeInches: 27,
        },
        {
          monitorId: 'unknown',
          bounds: { x: 2560, y: 0, width: 2560, height: 1440, rotation: 0 },
          physicalSizeInches: null,
        },
      ]),
    );
    expect(placed.unknown!.width).toBe(placed.known!.width);
  });

  it('still places a panel that touches nothing', () => {
    const placed = arrangeFromDesktop([
      {
        monitorId: 'a',
        bounds: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 },
        physicalSizeInches: 24,
      },
      {
        monitorId: 'b',
        bounds: { x: 5000, y: 0, width: 1920, height: 1080, rotation: 0 },
        physicalSizeInches: 24,
      },
    ]);
    expect(placed).toHaveLength(2);
  });

  it('calls a 270 degree rotation portrait-right', () => {
    const [placed] = arrangeFromDesktop([
      {
        monitorId: 'a',
        bounds: { x: 0, y: 0, width: 1080, height: 1920, rotation: 270 },
        physicalSizeInches: 24,
      },
    ]);
    expect(placed!.orientation).toBe('portrait-right');
  });
});
