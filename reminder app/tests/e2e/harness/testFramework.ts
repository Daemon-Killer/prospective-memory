/**
 * Zero-Dependency Test Framework Primitives for E2E Suite Execution
 */

export interface TestCaseResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: Error;
}

export interface SuiteSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestCaseResult[];
}

interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

interface TestSuite {
  name: string;
  tests: TestCase[];
}

const registeredSuites: TestSuite[] = [];
let currentSuite: TestSuite | null = null;

export function describe(name: string, fn: () => void): void {
  const suite: TestSuite = { name, tests: [] };
  registeredSuites.push(suite);
  currentSuite = suite;
  fn();
  currentSuite = null;
}

export function it(name: string, fn: () => void | Promise<void>): void {
  if (!currentSuite) {
    throw new Error(`Test '${name}' must be registered inside a describe block`);
  }
  currentSuite.tests.push({ name, fn });
}

export function expect<T>(actual: T) {
  return {
    not: {
      toBe(expected: any) {
        if (actual === expected) {
          throw new Error(`Expected ${JSON.stringify(actual)} NOT to be strictly equal to ${JSON.stringify(expected)}`);
        }
      },
      toEqual(expected: any) {
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
          throw new Error(`Expected values not to equal each other: ${JSON.stringify(actual)}`);
        }
      },
      toBeNull() {
        if (actual === null) {
          throw new Error(`Expected value NOT to be null`);
        }
      },
      toBeUndefined() {
        if (actual === undefined) {
          throw new Error(`Expected value NOT to be undefined`);
        }
      },
      toContain(item: any) {
        if (Array.isArray(actual) && actual.includes(item)) {
          throw new Error(`Expected array NOT to contain ${JSON.stringify(item)}`);
        }
        if (typeof actual === 'string' && actual.includes(String(item))) {
          throw new Error(`Expected string NOT to contain '${item}'`);
        }
      },
    },
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(actual)} to be strictly equal to ${JSON.stringify(expected)}`);
      }
    },
    toEqual(expected: any) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) {
        throw new Error(`Expected:\n${e}\nReceived:\n${a}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, received ${JSON.stringify(actual)}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined, received ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined value, received undefined`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, received ${JSON.stringify(actual)}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, received ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== 'number' || actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toContain(item: any) {
      if (Array.isArray(actual)) {
        if (!actual.includes(item)) {
          throw new Error(`Expected array to contain ${JSON.stringify(item)}`);
        }
      } else if (typeof actual === 'string') {
        if (!actual.includes(String(item))) {
          throw new Error(`Expected string '${actual}' to contain '${item}'`);
        }
      } else {
        throw new Error(`toContain called on non-collection type`);
      }
    },
    async toThrow(expectedSnippet?: string | RegExp) {
      if (typeof actual !== 'function') {
        throw new Error('toThrow requires a function');
      }
      let threw = false;
      let error: any = null;
      try {
        const res = (actual as any)();
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (err) {
        threw = true;
        error = err;
      }
      if (!threw) {
        throw new Error(`Expected function to throw, but it did not throw`);
      }
      if (expectedSnippet && error) {
        const msg = error.message || String(error);
        if (typeof expectedSnippet === 'string') {
          if (!msg.includes(expectedSnippet)) {
            throw new Error(`Expected thrown message '${msg}' to contain snippet '${expectedSnippet}'`);
          }
        } else if (expectedSnippet instanceof RegExp) {
          if (!expectedSnippet.test(msg)) {
            throw new Error(`Expected thrown message '${msg}' to match regex ${expectedSnippet}`);
          }
        }
      }
    },
  };
}

export async function runAllSuites(): Promise<SuiteSummary> {
  const summary: SuiteSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    durationMs: 0,
    results: [],
  };

  const startTime = Date.now();

  for (const suite of registeredSuites) {
    for (const testCase of suite.tests) {
      summary.total++;
      const testStart = Date.now();
      try {
        await testCase.fn();
        const durationMs = Date.now() - testStart;
        summary.passed++;
        summary.results.push({
          suite: suite.name,
          name: testCase.name,
          passed: true,
          durationMs,
        });
      } catch (err: any) {
        const durationMs = Date.now() - testStart;
        summary.failed++;
        summary.results.push({
          suite: suite.name,
          name: testCase.name,
          passed: false,
          durationMs,
          error: err,
        });
      }
    }
  }

  summary.durationMs = Date.now() - startTime;
  return summary;
}

export function clearRegisteredSuites(): void {
  registeredSuites.length = 0;
  currentSuite = null;
}
