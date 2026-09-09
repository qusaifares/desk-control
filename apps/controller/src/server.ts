import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  ApplyPresetRequestSchema,
  DeclareComputerRequestSchema,
  RenameRequestSchema,
  SetMonitorSourceRequestSchema,
  SetMonitorBrightnessRequestSchema,
  SetMonitorPowerRequestSchema,
  SetPeripheralOwnerRequestSchema,
  SetPlacementRequestSchema,
  SetWiringRequestSchema,
} from '@desk-control/protocol';
import type { ControllerInfo } from '@desk-control/domain';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { AgentGateway } from './agent-gateway.js';
import { type CommandService } from './command-service.js';
import type { ControllerConfig } from './config.js';
import type { DeskStore } from './desk-store.js';
import type { Logger } from './logger.js';
import { buildSnapshot } from './snapshot.js';

export interface ControllerServer {
  app: FastifyInstance;
  gateway: AgentGateway;
  commands: CommandService;
  broadcast(): void;
  close(): Promise<void>;
}

const SNAPSHOT_DEBOUNCE_MS = 40;

export async function createServer(options: {
  store: DeskStore;
  config: ControllerConfig;
  controllerInfo: ControllerInfo;
  logger: Logger;
  commandServiceFactory: (gateway: AgentGateway) => CommandService;
}): Promise<ControllerServer> {
  const { store, config, controllerInfo, logger } = options;

  const app: FastifyInstance = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
  await app.register(fastifyWebsocket);

  const gateway = new AgentGateway(store, config, controllerInfo, logger);
  const commands = options.commandServiceFactory(gateway);
  gateway.attachCommandService(commands);
  gateway.start();

  const uiClients = new Set<WebSocket>();
  let broadcastTimer: NodeJS.Timeout | null = null;

  const broadcastNow = () => {
    broadcastTimer = null;
    if (uiClients.size === 0) return;
    const frame = JSON.stringify({
      type: 'snapshot',
      snapshot: buildSnapshot(store, controllerInfo),
    });
    for (const client of uiClients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  };

  // Coalesce bursts (a preset touches the store many times) into one frame.
  const broadcast = () => {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(broadcastNow, SNAPSHOT_DEBOUNCE_MS);
  };

  const unsubscribe = store.subscribe(broadcast);

  app.get('/api/health', async () => ({
    ok: true,
    controller: controllerInfo,
    agents: store.agents.size,
    monitors: store.monitors.size,
  }));

  app.get('/api/desk', async () => buildSnapshot(store, controllerInfo));

  app.post('/api/desk/monitor-source', async (request, reply) => {
    const parsed = SetMonitorSourceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const result = commands.setMonitorSource({
      monitorId: parsed.data.monitorId,
      sourceComputerId: parsed.data.sourceComputerId,
      origin: 'user',
      ...(parsed.data.commandId ? { commandId: parsed.data.commandId } : {}),
    });
    if (result.status === 'rejected') {
      return reply.status(409).send({ error: { code: result.code, message: result.message } });
    }
    return { accepted: true, commandIds: [result.commandId], skipped: [] };
  });

  app.post('/api/desk/monitor-brightness', async (request, reply) => {
    const parsed = SetMonitorBrightnessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const result = commands.setMonitorBrightness({
      monitorId: parsed.data.monitorId,
      brightness: parsed.data.brightness,
      origin: 'user',
      ...(parsed.data.commandId ? { commandId: parsed.data.commandId } : {}),
    });
    if (result.status === 'rejected') {
      return reply.status(409).send({ error: { code: result.code, message: result.message } });
    }
    return { accepted: true, commandIds: [result.commandId], skipped: [] };
  });

  app.post('/api/desk/monitor-power', async (request, reply) => {
    const parsed = SetMonitorPowerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }

    // No monitorId means the whole desk, which is what the quick actions use.
    if (!parsed.data.monitorId) {
      const all = commands.setAllMonitorsPower(parsed.data.powerState);
      return { accepted: true, commandIds: all.commandIds, skipped: all.skipped };
    }

    const result = commands.setMonitorPower({
      monitorId: parsed.data.monitorId,
      powerState: parsed.data.powerState,
      origin: 'user',
    });
    if (result.status === 'rejected') {
      return reply.status(409).send({ error: { code: result.code, message: result.message } });
    }
    return { accepted: true, commandIds: [result.commandId], skipped: [] };
  });

  app.post('/api/desk/peripheral-owner', async (request, reply) => {
    const parsed = SetPeripheralOwnerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const result = commands.setPeripheralOwner({
      peripheralId: parsed.data.peripheralId,
      ownerComputerId: parsed.data.ownerComputerId,
      origin: 'user',
      ...(parsed.data.commandId ? { commandId: parsed.data.commandId } : {}),
    });
    if (result.status === 'rejected') {
      return reply.status(409).send({ error: { code: result.code, message: result.message } });
    }
    return { accepted: true, commandIds: [result.commandId], skipped: [] };
  });

  app.post('/api/desk/preset', async (request, reply) => {
    const parsed = ApplyPresetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const result = commands.applyPreset(parsed.data.presetId);
    if (result.status === 'rejected') {
      return reply
        .status(404)
        .send({ error: { code: 'UNKNOWN_TARGET', message: result.message ?? 'Unknown preset' } });
    }
    return { accepted: true, commandIds: result.commandIds, skipped: result.skipped };
  });

  app.post('/api/desk/name', async (request, reply) => {
    const parsed = RenameRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const ok = store.setCustomName(
      parsed.data.entityType,
      parsed.data.entityId,
      parsed.data.customName,
    );
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: 'UNKNOWN_TARGET', message: 'Unknown entity' } });
    }
    return { accepted: true, commandIds: [], skipped: [] };
  });

  app.post('/api/desk/layout', async (request, reply) => {
    const parsed = SetPlacementRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const ok = store.setPlacement(parsed.data.monitorId, {
      ...parsed.data.placement,
      autoPlaced: false,
    });
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: 'UNKNOWN_TARGET', message: 'Unknown monitor' } });
    }
    return { accepted: true, commandIds: [], skipped: [] };
  });

  app.post('/api/desk/wiring', async (request, reply) => {
    const parsed = SetWiringRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const ok = store.setWiringOverride(
      parsed.data.monitorId,
      parsed.data.inputId,
      parsed.data.computerId,
    );
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: 'UNKNOWN_TARGET', message: 'Unknown monitor, input or computer' } });
    }
    return { accepted: true, commandIds: [], skipped: [] };
  });

  app.post('/api/desk/computers', async (request, reply) => {
    const parsed = DeclareComputerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
    }
    const computer = store.declareComputer(parsed.data.detectedName, parsed.data.platform);
    return { accepted: true, commandIds: [], skipped: [], computerId: computer.id };
  });

  app.get('/api/stream', { websocket: true }, (socket) => {
    uiClients.add(socket);
    socket.send(
      JSON.stringify({ type: 'snapshot', snapshot: buildSnapshot(store, controllerInfo) }),
    );
    socket.on('close', () => uiClients.delete(socket));
    socket.on('error', () => uiClients.delete(socket));
  });

  app.get('/agent', { websocket: true }, (socket) => {
    gateway.handleConnection(socket);
  });

  // Optional: serve a built UI so the Pi can run one process.
  if (config.webDir && existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/agent')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such route' } });
      }
      return reply.sendFile('index.html');
    });
    logger.info({ webDir: config.webDir }, 'Serving web UI from controller');
  }

  return {
    app,
    gateway,
    commands,
    broadcast: broadcastNow,
    async close() {
      unsubscribe();
      if (broadcastTimer) clearTimeout(broadcastTimer);
      gateway.stop();
      commands.dispose();
      await app.close();
    },
  };
}
