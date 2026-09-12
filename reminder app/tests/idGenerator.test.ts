/**
 * Remy Reminders - ID Generator Unit Tests
 */

import { generateId, isValidId } from '../src/utils/idGenerator';

describe('idGenerator', () => {
  it('generates a string matching RFC 4122 UUID v4 regex', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(isValidId(id)).toBe(true);
  });

  it('generates 100 unique identifiers with zero collision', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(isValidId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(100);
  });

  it('validates UUID v4 formatting correctly', () => {
    // Valid v4 UUID
    expect(isValidId('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    expect(isValidId('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d')).toBe(true);

    // Invalid non-v4 UUID (version is 1 instead of 4)
    expect(isValidId('f47ac10b-58cc-1372-a567-0e02b2c3d479')).toBe(false);

    // Invalid variant bits
    expect(isValidId('f47ac10b-58cc-4372-c567-0e02b2c3d479')).toBe(false);

    // Non-string / malformed values
    expect(isValidId('')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(12345)).toBe(false);
    expect(isValidId('random-string')).toBe(false);
  });

  it('executes fallback generation path if globalThis.crypto is undefined', () => {
    const originalCrypto = globalThis.crypto;
    try {
      // Temporarily mock crypto as undefined
      delete (globalThis as any).crypto;
      const id = generateId();
      expect(isValidId(id)).toBe(true);
    } finally {
      (globalThis as any).crypto = originalCrypto;
    }
  });
});
