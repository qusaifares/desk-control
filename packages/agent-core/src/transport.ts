import WebSocket from 'ws';

/**
 * Transport seam. The runtime speaks messages, not sockets, so the same agent
 * logic can be driven over a real WebSocket or an in-process pipe in tests.
 */
export interface AgentTransport {
  connect(url: string): Promise<void>;
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

export class WebSocketAgentTransport implements AgentTransport {
  private socket: WebSocket | null = null;
  private messageListener: ((message: unknown) => void) | null = null;
  private closeListener: ((reason: string) => void) | null = null;

  async connect(url: string): Promise<void> {
    const socket = new WebSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off('open', onOpen);
        reject(error);
      };
      socket.once('open', onOpen);
      socket.once('error', onError);
    });

    socket.on('message', (data) => {
      try {
        this.messageListener?.(JSON.parse(data.toString()));
      } catch {
        // A frame we cannot even parse is dropped; the controller's own
        // validation will surface anything that matters.
      }
    });
    socket.on('close', (code, reason) => {
      this.closeListener?.(reason.toString() || `code ${code}`);
    });
    socket.on('error', (error) => {
      this.closeListener?.(error.message);
    });
  }

  send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListener = listener;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * A transport that hands frames to a caller-supplied peer function instead of a
 * socket. Used by tests to drive the runtime deterministically, and by any
 * future in-process agent (the controller host controlling its own displays).
 */
export class InMemoryAgentTransport implements AgentTransport {
  readonly sent: unknown[] = [];
  private messageListener: ((message: unknown) => void) | null = null;
  private closeListener: ((reason: string) => void) | null = null;
  private open = false;

  constructor(private readonly onSend: (message: unknown) => void = () => {}) {}

  async connect(_url: string): Promise<void> {
    this.open = true;
  }

  send(message: unknown): void {
    if (!this.open) return;
    this.sent.push(message);
    this.onSend(message);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListener = listener;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.closeListener?.('closed');
  }

  /** Test helper: deliver a controller frame to the runtime. */
  deliver(message: unknown): void {
    this.messageListener?.(message);
  }

  sentOfType<TPayload = Record<string, unknown>>(
    type: string,
  ): Array<{ type: string; payload: TPayload }> {
    return this.sent.filter(
      (message): message is { type: string; payload: TPayload } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === type,
    );
  }
}
