import type { ControllerDiscovery, ControllerEndpoint, EndpointListener } from './types.js';

/**
 * Discovery from explicit configuration. This is what runs today: an agent is
 * told the controller URL by config or environment. It is also the permanent
 * escape hatch for networks where multicast is filtered.
 */
export class StaticControllerDiscovery implements ControllerDiscovery {
  readonly kind = 'static';
  private readonly found = new Set<EndpointListener>();
  private readonly lost = new Set<EndpointListener>();
  private started = false;

  constructor(private readonly endpoints: readonly ControllerEndpoint[]) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const endpoint of this.endpoints) {
      for (const listener of this.found) listener(endpoint);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    for (const endpoint of this.endpoints) {
      for (const listener of this.lost) listener(endpoint);
    }
  }

  list(): ControllerEndpoint[] {
    return this.started ? [...this.endpoints] : [];
  }

  onFound(listener: EndpointListener): () => void {
    this.found.add(listener);
    if (this.started) for (const endpoint of this.endpoints) listener(endpoint);
    return () => this.found.delete(listener);
  }

  onLost(listener: EndpointListener): () => void {
    this.lost.add(listener);
    return () => this.lost.delete(listener);
  }
}
