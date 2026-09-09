import type { DeskSnapshot } from '@desk-control/domain';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? `Request failed: ${response.status}`);
  }
}

export const deskApi = {
  setMonitorSource: (monitorId: string, sourceComputerId: string) =>
    post('/api/desk/monitor-source', { monitorId, sourceComputerId }),
  setPeripheralOwner: (peripheralId: string, ownerComputerId: string) =>
    post('/api/desk/peripheral-owner', { peripheralId, ownerComputerId }),
  applyPreset: (presetId: string) => post('/api/desk/preset', { presetId }),
  rename: (
    entityType: 'computer' | 'monitor' | 'peripheral' | 'preset',
    entityId: string,
    customName: string | null,
  ) => post('/api/desk/name', { entityType, entityId, customName }),
};

/**
 * Subscribes to controller state.
 *
 * The controller pushes whole snapshots; the UI never derives desk state
 * locally and never optimistically applies a change it requested. Losing this
 * socket means "I can no longer see the desk", not "the desk changed".
 */
export function subscribeToDesk(handlers: {
  onSnapshot: (snapshot: DeskSnapshot) => void;
  onConnectionChange: (state: ConnectionState) => void;
}): () => void {
  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let closed = false;
  let receivedLive = false;

  /*
   * Paint from a plain HTTP read first, then let the socket take over.
   *
   * The desk is readable the moment the page loads instead of after a
   * WebSocket handshake, and a browser that cannot hold a socket open at all
   * still shows the desk rather than a spinner.
   */
  void fetch('/api/desk')
    .then((response) => (response.ok ? (response.json() as Promise<DeskSnapshot>) : null))
    .then((snapshot) => {
      if (snapshot && !closed && !receivedLive) handlers.onSnapshot(snapshot);
    })
    .catch(() => {
      // The socket is the real path; a failed prefetch changes nothing.
    });

  const connect = () => {
    if (closed) return;
    handlers.onConnectionChange('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${window.location.host}/api/stream`);

    socket.onopen = () => handlers.onConnectionChange('connected');
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          type: string;
          snapshot?: DeskSnapshot;
        };
        if (message.type === 'snapshot' && message.snapshot) {
          receivedLive = true;
          handlers.onSnapshot(message.snapshot);
        }
      } catch {
        // Ignore frames we cannot parse; the next snapshot supersedes them.
      }
    };
    socket.onclose = () => {
      handlers.onConnectionChange('disconnected');
      if (!closed) retryTimer = window.setTimeout(connect, 1500);
    };
    socket.onerror = () => socket?.close();
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    socket?.close();
  };
}
