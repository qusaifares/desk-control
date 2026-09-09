import { AgentRuntime, WebSocketAgentTransport } from '@desk-control/agent-core';
import { EXAMPLE_COMPUTERS, EXAMPLE_MONITOR_SPECS } from '@desk-control/config';
import { StaticControllerDiscovery } from '@desk-control/discovery';
import { MockMonitorControlProvider, SimulatedDesk } from '@desk-control/hardware';
import { PROTOCOL_VERSION } from '@desk-control/protocol';
import Fastify from 'fastify';
import pino from 'pino';
import { z } from 'zod';

/**
 * Development simulator.
 *
 * One process hosts a single SimulatedDesk and one AgentRuntime per simulated
 * computer. That matters: the monitors are *shared* hardware, so a switch
 * driven by the gaming PC's agent is seen by the MacBook's agent, and the PC
 * then loses DDC reachability exactly as it would in reality.
 *
 * A small HTTP API lets you stop and start individual agents and inject
 * hardware faults, which is how the offline and failure paths get exercised
 * without unplugging anything.
 */
const EnvSchema = z.object({
  DESK_CONTROL_URL: z.string().default('ws://127.0.0.1:7420/agent'),
  MOCK_DESK_PORT: z.coerce.number().int().positive().default(7430),
  MOCK_DESK_HOST: z.string().default('127.0.0.1'),
  DESK_CONTROL_PAIRING_TOKEN: z.string().default(''),
  MOCK_DESK_LOG_LEVEL: z.string().default('info'),
});

const env = EnvSchema.parse(process.env);

const logger = pino({
  level: env.MOCK_DESK_LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageKey: 'msg',
    },
  },
}).child({ service: 'mock-desk' });

const desk = new SimulatedDesk(EXAMPLE_MONITOR_SPECS);

const controllerUrl = new URL(env.DESK_CONTROL_URL);
const endpoint = {
  controllerId: 'controller:local',
  name: 'Desk Controller',
  host: controllerUrl.hostname,
  port: Number(controllerUrl.port || 7420),
  agentUrl: env.DESK_CONTROL_URL,
  protocolVersion: PROTOCOL_VERSION,
  discoveredVia: 'static',
};

interface SimulatedAgent {
  computerId: string;
  agentId: string;
  name: string;
  runtime: AgentRuntime;
  running: boolean;
}

const agents: SimulatedAgent[] = EXAMPLE_COMPUTERS.map((computer) => {
  const agentId = computer.id.replace(/^computer:/, 'agent:');
  const agentLogger = logger.child({ agent: computer.detectedName });
  const runtime = new AgentRuntime({
    agentId,
    computerId: computer.id,
    detectedName: `${computer.detectedName} agent`,
    computerDetectedName: computer.detectedName,
    platform: computer.platform,
    agentVersion: '0.1.0-mock',
    capabilities: computer.capabilities,
    metadata: computer.metadata,
    provider: new MockMonitorControlProvider(desk, computer.id),
    discovery: new StaticControllerDiscovery([endpoint]),
    createTransport: () => new WebSocketAgentTransport(),
    authToken: env.DESK_CONTROL_PAIRING_TOKEN || null,
    reconnectDelayMs: 1500,
    logger: {
      info: (message, context) => agentLogger.info(context ?? {}, message),
      warn: (message, context) => agentLogger.warn(context ?? {}, message),
      error: (message, context) => agentLogger.error(context ?? {}, message),
    },
  });
  return { computerId: computer.id, agentId, name: computer.detectedName, runtime, running: false };
});

async function startAgent(agent: SimulatedAgent): Promise<void> {
  if (agent.running) return;
  agent.running = true;
  await agent.runtime.start();
  logger.info({ agent: agent.name }, 'Simulated agent started');
}

async function stopAgent(agent: SimulatedAgent): Promise<void> {
  if (!agent.running) return;
  agent.running = false;
  await agent.runtime.stop();
  logger.warn({ agent: agent.name }, 'Simulated agent stopped (hardware left untouched)');
}

const control = Fastify({ logger: false });

control.get('/agents', async () => ({
  agents: agents.map((agent) => ({
    agentId: agent.agentId,
    computerId: agent.computerId,
    name: agent.name,
    running: agent.running,
    connected: agent.runtime.isConnected,
  })),
}));

control.post<{ Params: { id: string } }>('/agents/:id/stop', async (request, reply) => {
  const agent = agents.find((candidate) => candidate.agentId === request.params.id);
  if (!agent) return reply.status(404).send({ error: 'unknown agent' });
  await stopAgent(agent);
  return { ok: true, running: agent.running };
});

control.post<{ Params: { id: string } }>('/agents/:id/start', async (request, reply) => {
  const agent = agents.find((candidate) => candidate.agentId === request.params.id);
  if (!agent) return reply.status(404).send({ error: 'unknown agent' });
  await startAgent(agent);
  return { ok: true, running: agent.running };
});

const FaultSchema = z.object({
  mode: z.enum(['fail', 'unreachable', 'timeout']),
  code: z.string().default('SIMULATED_FAULT'),
  message: z.string().default('Injected fault'),
});

control.post<{ Params: { id: string } }>('/monitors/:id/fault', async (request, reply) => {
  const parsed = FaultSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
  if (!desk.get(request.params.id)) return reply.status(404).send({ error: 'unknown monitor' });
  desk.injectFault(
    request.params.id,
    parsed.data.mode === 'timeout'
      ? { mode: 'timeout' }
      : { mode: parsed.data.mode, code: parsed.data.code, message: parsed.data.message },
  );
  logger.warn({ monitor: request.params.id, fault: parsed.data.mode }, 'Injected hardware fault');
  return { ok: true };
});

control.delete<{ Params: { id: string } }>('/monitors/:id/fault', async (request, reply) => {
  if (!desk.get(request.params.id)) return reply.status(404).send({ error: 'unknown monitor' });
  desk.injectFault(request.params.id, null);
  return { ok: true };
});

control.get('/monitors', async () => ({
  monitors: desk.list().map((monitor) => ({
    stableId: monitor.stableId,
    detectedName: monitor.detectedName,
    activeInputId: monitor.activeInputId,
    switchingToInputId: monitor.switchingToInputId,
    fault: monitor.fault,
  })),
}));

async function main(): Promise<void> {
  await control.listen({ host: env.MOCK_DESK_HOST, port: env.MOCK_DESK_PORT });
  logger.info(
    {
      controller: env.DESK_CONTROL_URL,
      controlApi: `http://${env.MOCK_DESK_HOST}:${env.MOCK_DESK_PORT}`,
      monitors: EXAMPLE_MONITOR_SPECS.length,
      agents: agents.length,
    },
    'Simulated desk starting',
  );

  for (const agent of agents) await startAgent(agent);

  logger.info(
    `Stop an agent with: curl -XPOST http://${env.MOCK_DESK_HOST}:${env.MOCK_DESK_PORT}/agents/agent:gaming-pc/stop`,
  );
}

const shutdown = async () => {
  for (const agent of agents) await stopAgent(agent);
  await control.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
