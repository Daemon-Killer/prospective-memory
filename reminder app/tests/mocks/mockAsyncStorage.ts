/**
 * Zero-dependency In-Memory Mock for @react-native-async-storage/async-storage
 * For use in Jest tests without native binaries or Metro bundling.
 */

export class MockAsyncStorage {
  private store: Map<string, string> = new Map();

  getItem = jest.fn(async (key: string): Promise<string | null> => {
    return this.store.get(key) ?? null;
  });

  setItem = jest.fn(async (key: string, value: string): Promise<void> => {
    this.store.set(key, String(value));
  });

  removeItem = jest.fn(async (key: string): Promise<void> => {
    this.store.delete(key);
  });

  clear = jest.fn(async (): Promise<void> => {
    this.store.clear();
  });

  getAllKeys = jest.fn(async (): Promise<string[]> => {
    return Array.from(this.store.keys());
  });

  multiGet = jest.fn(async (keys: string[]): Promise<[string, string | null][]> => {
    return keys.map((key) => [key, this.store.get(key) ?? null]);
  });

  multiSet = jest.fn(async (keyValuePairs: [string, string][]): Promise<void> => {
    for (const [key, value] of keyValuePairs) {
      this.store.set(key, String(value));
    }
  });

  multiRemove = jest.fn(async (keys: string[]): Promise<void> => {
    for (const key of keys) {
      this.store.delete(key);
    }
  });

  /** Test helper to inspect raw stored JSON without calling mocked getItem */
  __getRaw(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  /** Test helper to inject pre-existing state into mock storage */
  __setRaw(key: string, value: string): void {
    this.store.set(key, value);
  }

  /** Test helper to reset internal store and mock invocation counts */
  __reset(): void {
    this.store.clear();
    this.getItem.mockClear();
    this.setItem.mockClear();
    this.removeItem.mockClear();
    this.clear.mockClear();
    this.getAllKeys.mockClear();
    this.multiGet.mockClear();
    this.multiSet.mockClear();
    this.multiRemove.mockClear();
  }
}

export const mockAsyncStorage = new MockAsyncStorage();
export default mockAsyncStorage;
