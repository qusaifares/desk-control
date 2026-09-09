/**
 * Wire protocol version.
 *
 * Bump whenever an existing message shape changes meaning. Adding an optional
 * field, or a brand new message type that old peers can ignore, does not need a
 * bump. The controller refuses agents whose version is outside the supported
 * range rather than guessing - a silently mis-parsed DDC command is worse than
 * a refused connection.
 */
export const PROTOCOL_VERSION = 1;

export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;
export const MAX_SUPPORTED_PROTOCOL_VERSION = 1;

export function isSupportedProtocolVersion(version: number): boolean {
  return version >= MIN_SUPPORTED_PROTOCOL_VERSION && version <= MAX_SUPPORTED_PROTOCOL_VERSION;
}
