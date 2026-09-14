/**
 * Kiosk mode, switched on by `?kiosk` in the URL the Pi's launcher opens.
 *
 * It hides the pointer - labwc draws a cursor even on a touch-only panel, and
 * the X11 tools that used to hide one do nothing on Wayland - and suppresses
 * the context menu a long press opens, which has nothing useful on it and no
 * keyboard to dismiss it with. Keyed off the URL rather than touch detection
 * so the same UI in a desktop browser keeps its pointer and right click.
 */
export function applyKioskMode(search: string, root: HTMLElement): boolean {
  const kiosk = new URLSearchParams(search).has('kiosk');
  if (!kiosk) return false;
  root.dataset.kiosk = 'true';
  root.addEventListener('contextmenu', (event) => event.preventDefault());
  return true;
}
