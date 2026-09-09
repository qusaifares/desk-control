import { describe, expect, it } from 'vitest';
import { toProtocolErrorCode } from './errors.js';
import { buildMessage, parseAgentMessage, parseControllerMessage } from './messages.js';
import { isSupportedProtocolVersion, PROTOCOL_VERSION } from './version.js';

describe('protocol versioning', () => {
  it('accepts the current version and rejects anything outside the supported range', () => {
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isSupportedProtocolVersion(0)).toBe(false);
  });

  it('stamps every outgoing message with the version and a unique id', () => {
    const first = buildMessage('agent.heartbeat', { uptimeSeconds: 1 });
    const second = buildMessage('agent.heartbeat', { uptimeSeconds: 2 });
    expect(first.v).toBe(PROTOCOL_VERSION);
    expect(first.messageId).not.toBe(second.messageId);
  });
});

describe('boundary validation', () => {
  it('accepts a well-formed hello and applies schema defaults', () => {
    const message = buildMessage('agent.hello', {
      agent: { id: 'agent:a', detectedName: 'A', agentVersion: '0.1.0', providerKind: 'mock' },
      computer: { id: 'computer:a', detectedName: 'A', platform: 'windows' },
      monitors: [],
    });

    const parsed = parseAgentMessage(message);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    if (parsed.data.type !== 'agent.hello') throw new Error('wrong type');
    // Optional fields get explicit defaults rather than being left undefined.
    expect(parsed.data.payload.authToken).toBeNull();
    expect(parsed.data.payload.computer.capabilities).toEqual([]);
  });

  it('rejects a message with an unknown type instead of passing it through', () => {
    const parsed = parseAgentMessage({
      v: PROTOCOL_VERSION,
      messageId: 'x',
      sentAt: new Date().toISOString(),
      type: 'agent.please-run-this',
      payload: {},
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a hello whose platform is not a known platform', () => {
    const parsed = parseAgentMessage({
      v: PROTOCOL_VERSION,
      messageId: 'x',
      sentAt: new Date().toISOString(),
      type: 'agent.hello',
      payload: {
        agent: { id: 'a', detectedName: 'A', agentVersion: '1', providerKind: 'mock' },
        computer: { id: 'c', detectedName: 'C', platform: 'beos' },
        monitors: [],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a monitor report that is missing its stable id', () => {
    const parsed = parseAgentMessage({
      v: PROTOCOL_VERSION,
      messageId: 'x',
      sentAt: new Date().toISOString(),
      type: 'agent.inventory',
      payload: {
        monitors: [
          {
            localHandle: 'h',
            detectedName: 'MON',
            identity: { manufacturerId: 'AUS', model: 'X' },
          },
        ],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('validates controller commands, including the idempotency key', () => {
    const good = parseControllerMessage(
      buildMessage('controller.command', {
        commandId: 'cmd-1',
        payload: {
          kind: 'set-monitor-input',
          monitorId: 'monitor:1',
          inputId: 'input-dp1',
          sourceComputerId: 'computer:a',
        },
        deadlineAt: new Date().toISOString(),
      }),
    );
    expect(good.success).toBe(true);

    const missingId = parseControllerMessage(
      buildMessage('controller.command', {
        commandId: '',
        payload: { kind: 'set-monitor-input', monitorId: 'm', inputId: 'i' },
        deadlineAt: new Date().toISOString(),
      }),
    );
    expect(missingId.success).toBe(false);
  });
});

describe('error codes', () => {
  it('narrows known provider codes and quarantines unknown ones as INTERNAL', () => {
    expect(toProtocolErrorCode('DEVICE_UNREACHABLE')).toBe('DEVICE_UNREACHABLE');
    expect(toProtocolErrorCode('SOMETHING_VENDOR_SPECIFIC')).toBe('INTERNAL');
  });
});
