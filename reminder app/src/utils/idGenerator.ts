/**
 * Remy Reminders - RFC 4122 Compliant UUID Version 4 Generator
 * Cross-platform: Node, Jest, React Native (Hermes/JSC), Expo Web
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates an RFC 4122 compliant UUID version 4 string.
 * Uses globalThis.crypto.randomUUID() if natively supported,
 * falling back to RFC 4122 compliant bit-manipulation.
 */
export function generateId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  // RFC 4122 version 4 pseudo-random generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const randomNibble = (Math.random() * 16) | 0;
    const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Validates whether a value is a valid RFC 4122 UUID v4 string.
 */
export function isValidId(id: unknown): boolean {
  if (typeof id !== 'string') {
    return false;
  }
  return UUID_V4_REGEX.test(id);
}

export const generateUUID = generateId;
export const isValidUUID = isValidId;

