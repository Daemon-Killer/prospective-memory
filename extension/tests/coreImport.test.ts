import { describe, it, expect } from 'vitest';
import { expandLingo, compileCapture, DEFAULT_LINGO } from '@core/captureCompilerCore';

describe('Core Parser Integration via @core alias', () => {
  it('imports and executes pure parser functions from reminder app without errors', () => {
    expect(DEFAULT_LINGO).toBeDefined();
    const exp = expandLingo('buy milk tmrw');
    expect(exp.output).toBeDefined();
    const draft = compileCapture('call mom today at 5pm');
    expect(draft.title).toBeDefined();
  });
});
