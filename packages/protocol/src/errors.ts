import { z } from 'zod';

/**
 * A closed set of error codes so both sides can branch on them without string
 * matching. Messages are for humans; codes are for programs.
 */
export const ProtocolErrorCodeSchema = z.enum([
  'INVALID_MESSAGE',
  'UNSUPPORTED_PROTOCOL_VERSION',
  'UNAUTHORIZED',
  'UNKNOWN_AGENT',
  'UNKNOWN_COMMAND_KIND',
  'UNKNOWN_TARGET',
  'CAPABILITY_UNSUPPORTED',
  'DEVICE_UNREACHABLE',
  'DEVICE_BUSY',
  'TIMEOUT',
  'SUPERSEDED',
  'NO_CONTROL_PATH',
  'INTERNAL',
]);
export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;

export const ProtocolErrorSchema = z.object({
  code: ProtocolErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean().default(false),
  /** Message id this error responds to, when applicable. */
  relatedMessageId: z.string().nullable().default(null),
});
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;

export class ProtocolException extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProtocolException';
  }

  toProtocolError(relatedMessageId: string | null = null): ProtocolError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      relatedMessageId,
    };
  }
}

/** Narrows an arbitrary provider error string to a known code. */
export function toProtocolErrorCode(code: string): ProtocolErrorCode {
  const parsed = ProtocolErrorCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : 'INTERNAL';
}
