import { describe, expect, it } from 'vitest';
import { applyKioskMode } from './kiosk.js';

describe('applyKioskMode', () => {
  it('marks the page when opened by the kiosk launcher', () => {
    const root = document.createElement('html');
    expect(applyKioskMode('?kiosk', root)).toBe(true);
    expect(root.dataset.kiosk).toBe('true');
  });

  it('swallows the long-press context menu in kiosk mode only', () => {
    const kiosk = document.createElement('html');
    applyKioskMode('?kiosk', kiosk);
    const pressed = new MouseEvent('contextmenu', { cancelable: true });
    kiosk.dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);

    const normal = document.createElement('html');
    applyKioskMode('', normal);
    const rightClick = new MouseEvent('contextmenu', { cancelable: true });
    normal.dispatchEvent(rightClick);
    expect(rightClick.defaultPrevented).toBe(false);
  });

  it('leaves a normal browser alone', () => {
    const root = document.createElement('html');
    expect(applyKioskMode('', root)).toBe(false);
    expect(root.dataset.kiosk).toBeUndefined();
  });
});
