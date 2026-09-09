import { z } from 'zod';

/**
 * Discovery direction
 * -------------------
 * Agents dial the controller, not the other way round. One well-known service
 * to find beats N agents to scan for, it needs no inbound ports on user
 * machines, and it keeps the trust decision in one place (the controller
 * decides who may join).
 *
 * So: the controller *advertises*, agents *discover*.
 */
export const ControllerEndpointSchema = z.object({
  controllerId: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  /** Full websocket URL agents should connect to. */
  agentUrl: z.string().url(),
  protocolVersion: z.number().int().positive(),
  /** How this endpoint was learned: "static", "mdns", "memory". */
  discoveredVia: z.string(),
});
export type ControllerEndpoint = z.infer<typeof ControllerEndpointSchema>;

export type EndpointListener = (endpoint: ControllerEndpoint) => void;

/**
 * Implementations: StaticControllerDiscovery (config/env), InMemory (tests),
 * and - the intended production path - mDNS/DNS-SD browsing for
 * `_deskctl._tcp.local`. Nothing above this interface knows which is in use.
 */
export interface ControllerDiscovery {
  readonly kind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Endpoints known right now. */
  list(): ControllerEndpoint[];
  onFound(listener: EndpointListener): () => void;
  onLost(listener: EndpointListener): () => void;
}

/** The controller side of the same mechanism. */
export interface ControllerAdvertiser {
  readonly kind: string;
  advertise(endpoint: ControllerEndpoint): Promise<void>;
  stop(): Promise<void>;
}

/** DNS-SD service type reserved for this project. */
export const SERVICE_TYPE = '_deskctl._tcp';
