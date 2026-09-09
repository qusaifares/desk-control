import type {
  ControllerAdvertiser,
  ControllerDiscovery,
  ControllerEndpoint,
  EndpointListener,
} from './types.js';

/**
 * A process-local stand-in for mDNS. An advertiser publishes into a registry
 * and discoveries browsing the same registry see it appear and disappear.
 *
 * Used by tests and by in-process dev setups to exercise the full
 * advertise -> discover -> connect path without touching the network.
 */
export class InMemoryDiscoveryRegistry {
  private readonly endpoints = new Map<string, ControllerEndpoint>();
  private readonly found = new Set<EndpointListener>();
  private readonly lost = new Set<EndpointListener>();

  publish(endpoint: ControllerEndpoint): void {
    this.endpoints.set(endpoint.controllerId, endpoint);
    for (const listener of this.found) listener(endpoint);
  }

  unpublish(controllerId: string): void {
    const endpoint = this.endpoints.get(controllerId);
    if (!endpoint) return;
    this.endpoints.delete(controllerId);
    for (const listener of this.lost) listener(endpoint);
  }

  list(): ControllerEndpoint[] {
    return [...this.endpoints.values()];
  }

  subscribe(kind: 'found' | 'lost', listener: EndpointListener): () => void {
    const target = kind === 'found' ? this.found : this.lost;
    target.add(listener);
    return () => target.delete(listener);
  }
}

export class InMemoryControllerDiscovery implements ControllerDiscovery {
  readonly kind = 'memory';
  private unsubscribers: Array<() => void> = [];
  private started = false;

  constructor(private readonly registry: InMemoryDiscoveryRegistry) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  list(): ControllerEndpoint[] {
    return this.started ? this.registry.list() : [];
  }

  onFound(listener: EndpointListener): () => void {
    const unsubscribe = this.registry.subscribe('found', listener);
    this.unsubscribers.push(unsubscribe);
    for (const endpoint of this.registry.list()) listener(endpoint);
    return unsubscribe;
  }

  onLost(listener: EndpointListener): () => void {
    const unsubscribe = this.registry.subscribe('lost', listener);
    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }
}

export class InMemoryControllerAdvertiser implements ControllerAdvertiser {
  readonly kind = 'memory';
  private advertised: string | null = null;

  constructor(private readonly registry: InMemoryDiscoveryRegistry) {}

  async advertise(endpoint: ControllerEndpoint): Promise<void> {
    this.advertised = endpoint.controllerId;
    this.registry.publish(endpoint);
  }

  async stop(): Promise<void> {
    if (this.advertised) this.registry.unpublish(this.advertised);
    this.advertised = null;
  }
}

/**
 * Advertiser used when discovery is off. Kept explicit so the controller always
 * has an advertiser object and turning mDNS on is a one-line swap.
 */
export class NoopControllerAdvertiser implements ControllerAdvertiser {
  readonly kind = 'noop';
  async advertise(_endpoint: ControllerEndpoint): Promise<void> {}
  async stop(): Promise<void> {}
}
