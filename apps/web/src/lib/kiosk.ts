/**
 * Kiosk mode, switched on by `?kiosk` in the URL the Pi's launcher opens.
 *
 * The only thing it does is hide the pointer. labwc draws a cursor even on a
 * touch-only panel, and the X11 tools that used to hide one do nothing on
 * Wayland. Keyed off the URL rather than touch detection so the same UI in a
 * desktop browser keeps its pointer.
 */
export function applyKioskMode(search: string, root: HTMLElement): boolean {
  const kiosk = new URLSearchParams(search).has('kiosk');
  if (kiosk) root.dataset.kiosk = 'true';
  return kiosk;
}
