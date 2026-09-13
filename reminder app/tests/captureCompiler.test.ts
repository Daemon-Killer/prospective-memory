import {
  compileCapture,
  compileMultiLineCapture,
  compressToLingo,
  expandLingo,
  getLingoSuggestions,
  getStoredLingo,
  inferTimeCue,
  resetStoredLingo,
  saveStoredLingo,
  splitMultiLine,
} from '../src/utils/captureCompiler';
import { calculateThisEvening, calculateTomorrowMorning } from '../src/utils/snoozeCalculator';

describe('captureCompiler', () => {
  const now = new Date(2026, 8, 13, 10, 0, 0);

  describe('lingo', () => {
    it('expands d to dahi lena', () => {
      const result = expandLingo('d');
      expect(result.changed).toBe(true);
      expect(result.output).toBe('dahi lena');
      expect(result.key).toBe('d');
    });

    it('fills $ templates: c mom → call mom', () => {
      expect(expandLingo('c mom').output).toBe('call mom');
      expect(expandLingo('call dad').output).toBe('call dad');
    });

    it('appends rest when template has no $', () => {
      expect(expandLingo('d from store').output).toBe('dahi lena from store');
    });

    it('leaves unknown text unchanged', () => {
      const result = expandLingo('submit tax form');
      expect(result.changed).toBe(false);
      expect(result.output).toBe('submit tax form');
    });
  });

  describe('time inference', () => {
    it('reads tonight / shaam as evening', () => {
      const hit = inferTimeCue('pay bill tonight', now);
      expect(hit?.preset).toBe('evening');
      expect(hit?.strippedTitle).toBe('pay bill');
      expect(hit?.dueDate.getTime()).toBe(calculateThisEvening(now).getTime());
    });

    it('reads tomorrow / kal as tomorrow morning', () => {
      const hit = inferTimeCue('call mom kal', now);
      expect(hit?.preset).toBe('tomorrow_morning');
      expect(hit?.dueDate.getTime()).toBe(calculateTomorrowMorning(now).getTime());
    });
  });

  describe('compileCapture', () => {
    it('dumps to unarmed inbox by default', () => {
      const draft = compileCapture('buy milk', 'inbox', now);
      expect(draft.armed).toBe(false);
      expect(draft.preset).toBe('inbox');
      expect(draft.title).toBe('buy milk');
    });

    it('honors an explicit time chip even without a time phrase', () => {
      const draft = compileCapture('buy milk', '1h', now);
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('1h');
    });

    it('arms from a time phrase when the inbox chip is selected', () => {
      const draft = compileCapture('submit taxes tonight', 'inbox', now);
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('evening');
      expect(draft.title).toBe('submit taxes');
    });

    it('expands pay bill lingo then arms from tonight', () => {
      const draft = compileCapture('pay bill tonight', 'inbox', now);
      expect(draft.title).toBe('pay electricity bill');
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('evening');
    });

    it('expands lingo then infers time: c mom tonight', () => {
      const draft = compileCapture('c mom tonight', 'inbox', now);
      expect(draft.title).toBe('call mom');
      expect(draft.armed).toBe(true);
      expect(draft.preset).toBe('evening');
      expect(draft.lingoKey).toBe('c');
    });
  });

  describe('multi-line paste splitting', () => {
    it('splits multi-line text into trimmed non-empty lines', () => {
      const input = '  buy milk \n\n  call plumber  \r\n  pay electricity bill \n  ';
      const lines = splitMultiLine(input);
      expect(lines).toEqual(['buy milk', 'call plumber', 'pay electricity bill']);
    });

    it('compiles multi-line capture into individual drafts', () => {
      const input = 'd\nc mom\nbuy apples';
      const drafts = compileMultiLineCapture(input, 'inbox', now);
      expect(drafts).toHaveLength(3);
      expect(drafts[0].title).toBe('dahi lena');
      expect(drafts[0].armed).toBe(false);
      expect(drafts[1].title).toBe('call mom');
      expect(drafts[1].armed).toBe(false);
      expect(drafts[2].title).toBe('buy apples');
      expect(drafts[2].armed).toBe(false);
    });

    it('applies time chip to all lines when selected', () => {
      const input = 'line 1\nline 2';
      const drafts = compileMultiLineCapture(input, '15m', now);
      expect(drafts).toHaveLength(2);
      expect(drafts[0].armed).toBe(true);
      expect(drafts[0].preset).toBe('15m');
      expect(drafts[1].armed).toBe(true);
      expect(drafts[1].preset).toBe('15m');
    });

    it('handles adversarial 200+ line paste splitting instantaneously without truncation', () => {
      const lines = Array.from({ length: 250 }, (_, i) => `Task item #${i + 1} kal`);
      const massiveInput = lines.join('\n');
      const start = Date.now();
      const drafts = compileMultiLineCapture(massiveInput, 'inbox', now);
      const elapsed = Date.now() - start;
      expect(drafts).toHaveLength(250);
      expect(drafts[0].title).toBe('Task item #1');
      expect(drafts[0].armed).toBe(true);
      expect(drafts[249].title).toBe('Task item #250');
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('lingo compression & suggestions', () => {
    it('compresses exact match to shortest key: dahi lena → d', () => {
      const res = compressToLingo('dahi lena');
      expect(res.compressed).toBe('d');
      expect(res.key).toBe('d');
    });

    it('compresses parameterized match: call mom → c mom', () => {
      const res = compressToLingo('call mom');
      expect(res.compressed).toBe('c mom');
      expect(res.key).toBe('c');
    });

    it('leaves text unchanged when no match exists', () => {
      const res = compressToLingo('read war and peace');
      expect(res.compressed).toBe('read war and peace');
      expect(res.key).toBeNull();
    });

    it('provides lingo suggestions matching prefix', () => {
      const suggestions = getLingoSuggestions('c');
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some(([k]) => k === 'c' || k === 'call')).toBe(true);
    });
  });

  describe('stored lingo persistence', () => {
    it('retrieves default lingo when nothing saved', async () => {
      const lingo = await getStoredLingo();
      expect(lingo).toContain('dahi lena');
    });

    it('saves and retrieves custom lingo table', async () => {
      const custom = 'g=groceries\nt=tea';
      await saveStoredLingo(custom);
      expect(await getStoredLingo()).toBe(custom);
      await resetStoredLingo();
      expect(await getStoredLingo()).toContain('dahi lena');
    });
  });
});

