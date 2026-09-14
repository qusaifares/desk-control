import { describe, expect, it } from 'vitest';
import { applyKioskMode } from './kiosk.js';

describe('applyKioskMode', () => {
  it('marks the page when opened by the kiosk launcher', () => {
    const root = document.createElement('html');
    expect(applyKioskMode('?kiosk', root)).toBe(true);
    expect(root.dataset.kiosk).toBe('true');
  });

  it('leaves a normal browser alone', () => {
    const root = document.createElement('html');
    expect(applyKioskMode('', root)).toBe(false);
    expect(root.dataset.kiosk).toBeUndefined();
  });
});
