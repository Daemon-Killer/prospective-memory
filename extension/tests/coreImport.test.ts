import { describe, it, expect } from 'vitest';
import { expandLingo, compileCapture, compileCaptureWithIntent, parseMusicIntent, DEFAULT_LINGO } from '@core/captureCompilerCore';

describe('Core Parser Integration via @core alias', () => {
  it('imports and executes pure parser functions from reminder app without errors', () => {
    expect(DEFAULT_LINGO).toBeDefined();
    const exp = expandLingo('buy milk tmrw');
    expect(exp.output).toBeDefined();
    const draft = compileCapture('call mom today at 5pm');
    expect(draft.title).toBeDefined();
  });

  it('imports and parses natural language music intent in extension environment', () => {
    const musicDraft = compileCaptureWithIntent('play spb songs hindi');
    expect(musicDraft.musicDraft).toBeDefined();
    expect(musicDraft.musicDraft?.action).toBe('play');
    expect(musicDraft.musicDraft?.cleanQuery).toBe('spb songs hindi');

    // Disambiguation
    const taskDraft = compileCapture('play tennis');
    expect(taskDraft.musicDraft).toBeUndefined();
  });
});
