import { describe, it, expect } from 'vitest';
import {
  compileToReminder,
  compileCaptureWithIntent,
  expandLingo,
  DEFAULT_LINGO,
} from '../src/main/compiler';

describe('Desktop Natural Language Compiler Integration', () => {
  it('compiles standard quick-capture thoughts into reminders', () => {
    const raw = 'call accountant 5pm';
    const { reminder, draft } = compileToReminder(raw);

    expect(reminder.id).toBeDefined();
    expect(reminder.title.toLowerCase()).toContain('call accountant');
    expect(reminder.status).toBe('pending');
    expect(reminder.dueDate).toBeDefined();
    expect(draft.preset).toBeDefined();
  });

  it('correctly expands custom lingo table entries like dahi', () => {
    const expansion = expandLingo('dahi 15m', DEFAULT_LINGO);
    expect(expansion.changed).toBe(true);
    expect(expansion.output).toContain('dahi lena');
  });

  it('compiles +15m shorthand to proper due date', () => {
    const { reminder, draft } = compileToReminder('dahi 15m');
    expect(reminder.title).toContain('dahi lena');
    expect(draft.preset).toBe('15m');

    const dueMs = new Date(reminder.dueDate).getTime();
    const nowMs = Date.now();
    // Due within ~14-16 minutes
    expect(dueMs).toBeGreaterThan(nowMs + 10 * 60 * 1000);
    expect(dueMs).toBeLessThan(nowMs + 20 * 60 * 1000);
  });

  it('parses music intent accurately without false positives on sports', () => {
    const musicDraft = compileCaptureWithIntent('play spb songs hindi');
    expect(musicDraft.musicDraft).toBeDefined();
    expect(musicDraft.musicDraft?.action).toBe('play');
    expect(musicDraft.musicDraft?.cleanQuery).toBe('spb songs hindi');

    // Non-music activity should not be classified as music intent
    const sportsDraft = compileCaptureWithIntent('play tennis tomorrow');
    expect(sportsDraft.musicDraft).toBeUndefined();
  });
});
