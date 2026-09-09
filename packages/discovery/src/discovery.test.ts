import { describe, expect, it } from 'vitest';
import {
  InMemoryControllerAdvertiser,
  InMemoryControllerDiscovery,
  InMemoryDiscoveryRegistry,
} from './memory-discovery.js';
import { StaticControllerDiscovery } from './static-discovery.js';
import type { ControllerEndpoint } from './types.js';

const endpoint: ControllerEndpoint = {
  controllerId: 'controller:1',
  name: 'Desk Controller',
  host: '192.168.1.10',
  port: 7420,
  agentUrl: 'ws://192.168.1.10:7420/agent',
  protocolVersion: 1,
  discoveredVia: 'test',
};

describe('StaticControllerDiscovery', () => {
  it('reports nothing until started, so an agent cannot connect to a stale endpoint', async () => {
    const discovery = new StaticControllerDiscovery([endpoint]);
    expect(discovery.list()).toEqual([]);
    await discovery.start();
    expect(discovery.list()).toEqual([endpoint]);
    await discovery.stop();
    expect(discovery.list()).toEqual([]);
  });

  it('notifies a late subscriber about endpoints it already knows', async () => {
    const discovery = new StaticControllerDiscovery([endpoint]);
    await discovery.start();
    const seen: ControllerEndpoint[] = [];
    discovery.onFound((found) => seen.push(found));
    expect(seen).toEqual([endpoint]);
  });
});

describe('advertise -> discover', () => {
  it('delivers appearance and disappearance to browsing agents', async () => {
    const registry = new InMemoryDiscoveryRegistry();
    const advertiser = new InMemoryControllerAdvertiser(registry);
    const discovery = new InMemoryControllerDiscovery(registry);
    await discovery.start();

    const found: string[] = [];
    const lost: string[] = [];
    discovery.onFound((e) => found.push(e.controllerId));
    discovery.onLost((e) => lost.push(e.controllerId));

    await advertiser.advertise(endpoint);
    expect(found).toEqual(['controller:1']);
    expect(discovery.list()).toHaveLength(1);

    await advertiser.stop();
    expect(lost).toEqual(['controller:1']);
    expect(discovery.list()).toHaveLength(0);
  });
});
