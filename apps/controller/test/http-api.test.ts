import { EXAMPLE_COMPUTER_IDS, EXAMPLE_MONITOR_IDS } from '@desk-control/config';
import { DeskSnapshotSchema } from '@desk-control/domain';
import { buildMessage, PROTOCOL_VERSION } from '@desk-control/protocol';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('client API', () => {
  it('serves a snapshot that satisfies the published schema', async () => {
    const response = await harness.server.app.inject({ method: 'GET', url: '/api/desk' });
    expect(response.statusCode).toBe(200);
    // If this ever fails, a UI client somewhere is about to break.
    expect(() => DeskSnapshotSchema.parse(response.json())).not.toThrow();
  });

  it('accepts a monitor source change and echoes the command id', async () => {
    const response = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/monitor-source',
      payload: {
        monitorId: EXAMPLE_MONITOR_IDS.topLandscape,
        sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { accepted: boolean; commandIds: string[] };
    expect(body.accepted).toBe(true);
    expect(harness.store.commands.get(body.commandIds[0]!)?.origin).toBe('user');
  });

  it('honours a caller-supplied command id so a retried request is not a second switch', async () => {
    const payload = {
      monitorId: EXAMPLE_MONITOR_IDS.topLandscape,
      sourceComputerId: EXAMPLE_COMPUTER_IDS.m4MacBook,
      commandId: 'client-generated-1',
    };
    await harness.server.app.inject({ method: 'POST', url: '/api/desk/monitor-source', payload });
    expect(harness.store.commands.has('client-generated-1')).toBe(true);
  });

  it('rejects a malformed request with 400 and a machine-readable code', async () => {
    const response = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/monitor-source',
      payload: { monitorId: EXAMPLE_MONITOR_IDS.topLandscape },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('INVALID_REQUEST');
  });

  it('rejects an impossible routing with 409 rather than silently dropping it', async () => {
    const response = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/monitor-source',
      payload: {
        monitorId: EXAMPLE_MONITOR_IDS.leftPortrait,
        sourceComputerId: EXAMPLE_COMPUTER_IDS.surface,
      },
    });
    expect(response.statusCode).toBe(409);
  });

  it('applies a custom name without touching hardware identity', async () => {
    const response = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/override',
      payload: { entityId: EXAMPLE_MONITOR_IDS.topLandscape, customName: 'Cinema' },
    });
    expect(response.statusCode).toBe(200);

    const monitor = harness.store.monitors.get(EXAMPLE_MONITOR_IDS.topLandscape);
    expect(monitor?.customName).toBe('Cinema');
    expect(monitor?.detectedName).toBe('ASUS XG27AQM');
    expect(monitor?.identity.serial).toBe('ASUS-XG27-0001');
  });

  it('clears a custom name back to the detected name', async () => {
    await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/override',
      payload: { entityId: EXAMPLE_COMPUTER_IDS.gamingPc, customName: null },
    });
    const computer = harness.store.computers.get(EXAMPLE_COMPUTER_IDS.gamingPc);
    expect(computer?.customName).toBeNull();
    expect(computer?.detectedName).toBe('DESKTOP-GAMING');
  });
});

describe('desk editing routes', () => {
  /*
   * Route-level coverage on purpose: the store methods behind these are tested
   * directly elsewhere, which meant a refactor could delete the routes and
   * every test still passed. It did, once.
   */
  it('exposes every desk editing endpoint', async () => {
    const monitorId = EXAMPLE_MONITOR_IDS.topLandscape;

    const declared = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/computers',
      payload: { detectedName: 'PlayStation 5', platform: 'unknown' },
    });
    expect(declared.statusCode).toBe(200);
    const computerId = (declared.json() as { computerId: string }).computerId;

    const wiring = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/wiring',
      payload: { monitorId, inputId: 'input-usbc', computerId },
    });
    expect(wiring.statusCode).toBe(200);

    const layout = await harness.server.app.inject({
      method: 'POST',
      url: '/api/desk/layout',
      payload: {
        monitorId,
        placement: { x: 1, y: 2, width: 16, height: 9, orientation: 'landscape' },
      },
    });
    expect(layout.statusCode).toBe(200);
    expect(harness.store.monitors.get(monitorId)?.placement).toMatchObject({ x: 1, y: 2 });
  });

  it('404s on an unknown target and 400s on a malformed body', async () => {
    expect(
      (
        await harness.server.app.inject({
          method: 'POST',
          url: '/api/desk/layout',
          payload: {
            monitorId: 'monitor:ghost',
            placement: { x: 0, y: 0, width: 1, height: 1, orientation: 'landscape' },
          },
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await harness.server.app.inject({
          method: 'POST',
          url: '/api/desk/wiring',
          payload: { monitorId: EXAMPLE_MONITOR_IDS.topLandscape },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('pairing token', () => {
  it('rejects an agent that presents the wrong token, with a typed error', async () => {
    const guarded = await createHarness({ pairingToken: 'correct-horse' });
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${guarded.port}/agent`);
      const frame = await new Promise<Record<string, any>>((resolve, reject) => {
        socket.on('open', () => {
          socket.send(
            JSON.stringify(
              buildMessage('agent.hello', {
                agent: {
                  id: 'agent:intruder',
                  detectedName: 'intruder',
                  agentVersion: '0',
                  providerKind: 'mock',
                },
                computer: { id: 'computer:intruder', detectedName: 'intruder', platform: 'linux' },
                monitors: [],
                authToken: 'wrong',
              }),
            ),
          );
        });
        socket.on('message', (data) => resolve(JSON.parse(data.toString())));
        socket.on('error', reject);
      });

      expect(frame.type).toBe('controller.reject');
      expect(frame.payload.code).toBe('UNAUTHORIZED');
      expect(guarded.store.agents.has('agent:intruder')).toBe(false);
      socket.close();
    } finally {
      await guarded.close();
    }
  });

  it('rejects an agent speaking an unsupported protocol version', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${harness.port}/agent`);
    const frame = await new Promise<Record<string, any>>((resolve, reject) => {
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            ...buildMessage('agent.hello', {
              agent: {
                id: 'agent:future',
                detectedName: 'f',
                agentVersion: '9',
                providerKind: 'x',
              },
              computer: { id: 'computer:future', detectedName: 'f', platform: 'linux' },
              monitors: [],
            }),
            v: PROTOCOL_VERSION + 5,
          }),
        );
      });
      socket.on('message', (data) => resolve(JSON.parse(data.toString())));
      socket.on('error', reject);
    });

    expect(frame.type).toBe('controller.reject');
    expect(frame.payload.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    socket.close();
  });
});
