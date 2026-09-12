/**
 * In-Memory AsyncStorage Simulator with Fault Injection for E2E Testing
 */

export interface IAsyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

export class MockStorage implements IAsyncStorage {
  private data: Map<string, string> = new Map();
  private nextError: Error | null = null;
  public operationCount = 0;

  public async getItem(key: string): Promise<string | null> {
    this.checkInjectedError();
    this.operationCount++;
    const val = this.data.get(key);
    return val !== undefined ? val : null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.checkInjectedError();
    this.operationCount++;
    this.data.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.checkInjectedError();
    this.operationCount++;
    this.data.delete(key);
  }

  public async clear(): Promise<void> {
    this.checkInjectedError();
    this.operationCount++;
    this.data.clear();
  }

  public async getAllKeys(): Promise<string[]> {
    this.checkInjectedError();
    return Array.from(this.data.keys());
  }

  public injectCorruptData(key: string, payload: string): void {
    this.data.set(key, payload);
  }

  public injectErrorOnNextOperation(error: Error): void {
    this.nextError = error;
  }

  public getRawData(key: string): string | null {
    const val = this.data.get(key);
    return val !== undefined ? val : null;
  }

  public snapshot(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of this.data.entries()) {
      result[k] = v;
    }
    return result;
  }

  private checkInjectedError(): void {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
  }
}
