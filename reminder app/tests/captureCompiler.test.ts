import {
  cleanListPrefix,
  compileCapture,
  compileMultiLineCapture,
  compressToLingo,
  expandLingo,
  extractTags,
  getLingoSuggestions,
  getStoredLingo,
  inferTimeCue,
  isListOrMultiLine,
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

    it('splits markdown bullet points and checkboxes into atomic cards', () => {
      const input = [
        '- [ ] Buy oat milk tomorrow morning #groceries',
        '- [x] Call mom tonight #family',
        '* [ ] pay bill',
        '- Submit quarterly report',
        '* Water house plants kal',
        '• Check passport expiry',
        '▪ Fix bicycle chain',
      ].join('\n');

      const drafts = compileMultiLineCapture(input, 'inbox', now);
      expect(drafts).toHaveLength(7);
      expect(drafts[0].title).toBe('buy oat milk');
      expect(drafts[0].preset).toBe('tomorrow_morning');
      expect(drafts[0].armed).toBe(true);
      expect(drafts[0].tags).toEqual(['groceries']);

      expect(drafts[1].title).toBe('call mom');
      expect(drafts[1].preset).toBe('evening');
      expect(drafts[1].armed).toBe(true);
      expect(drafts[1].tags).toEqual(['family']);

      expect(drafts[2].title).toBe('pay electricity bill');
      expect(drafts[2].armed).toBe(false);

      expect(drafts[3].title).toBe('Submit quarterly report');
      expect(drafts[4].title).toBe('Water house plants');
      expect(drafts[4].preset).toBe('tomorrow_morning');
      expect(drafts[4].armed).toBe(true);

      expect(drafts[5].title).toBe('Check passport expiry');
      expect(drafts[6].title).toBe('Fix bicycle chain');
    });

    it('splits numbered lists (1., 2), (1)) and strips prefixes cleanly', () => {
      const input = [
        '1. Buy groceries',
        '2) Call dentist shaam',
        '(3) File taxes kal',
        '[4] Clean garage',
      ].join('\n');

      const drafts = compileMultiLineCapture(input, 'inbox', now);
      expect(drafts).toHaveLength(4);
      expect(drafts[0].title).toBe('buy groceries');
      expect(drafts[1].title).toBe('call dentist');
      expect(drafts[1].preset).toBe('evening');
      expect(drafts[1].armed).toBe(true);
      expect(drafts[2].title).toBe('File taxes');
      expect(drafts[2].preset).toBe('tomorrow_morning');
      expect(drafts[2].armed).toBe(true);
      expect(drafts[3].title).toBe('Clean garage');
    });

    it('splits inline bullet lists and numbered lists on a single line', () => {
      const inlineBullets = '• Buy groceries • Call landlord • Order medication';
      const bulletDrafts = compileMultiLineCapture(inlineBullets, 'inbox', now);
      expect(bulletDrafts).toHaveLength(3);
      expect(bulletDrafts[0].title).toBe('buy groceries');
      expect(bulletDrafts[1].title).toBe('call landlord');
      expect(bulletDrafts[2].title).toBe('Order medication');

      const inlineNumbered = '1. First task 2. Second task 3. Third task';
      const numDrafts = compileMultiLineCapture(inlineNumbered, 'inbox', now);
      expect(numDrafts).toHaveLength(3);
      expect(numDrafts[0].title).toBe('First task');
      expect(numDrafts[1].title).toBe('Second task');
      expect(numDrafts[2].title).toBe('Third task');

      const parenNumbered = '(1) Buy milk (2) Call dentist (3) Pick up dry cleaning';
      const parenDrafts = compileMultiLineCapture(parenNumbered, 'inbox', now);
      expect(parenDrafts).toHaveLength(3);
      expect(parenDrafts[0].title).toBe('buy milk');
      expect(parenDrafts[1].title).toBe('call dentist');
      expect(parenDrafts[2].title).toBe('Pick up dry cleaning');

      const bracketNumbered = '[1] Task one [2] Task two';
      const bracketDrafts = compileMultiLineCapture(bracketNumbered, 'inbox', now);
      expect(bracketDrafts).toHaveLength(2);
      expect(bracketDrafts[0].title).toBe('Task one');
      expect(bracketDrafts[1].title).toBe('Task two');

      const inlineDashes = '- Clean kitchen - Do laundry - Read book';
      const dashDrafts = compileMultiLineCapture(inlineDashes, 'inbox', now);
      expect(dashDrafts).toHaveLength(3);
      expect(dashDrafts[0].title).toBe('Clean kitchen');
      expect(dashDrafts[1].title).toBe('Do laundry');
      expect(dashDrafts[2].title).toBe('Read book');
    });

    it('cleans chained and nested list prefixes cleanly (1. [ ], • [x], etc.)', () => {
      expect(cleanListPrefix('1. [ ] Buy almond milk')).toBe('Buy almond milk');
      expect(cleanListPrefix('• [x] Done with report')).toBe('Done with report');
      expect(cleanListPrefix('- 1. Double prefixed')).toBe('Double prefixed');
      expect(cleanListPrefix('(2) [ ] Call bank')).toBe('Call bank');
    });

    it('extracts multiple tags including hyphenated tags (#work #grocery-list #q3_review) and cleans title', () => {
      const { tags, stripped } = extractTags('Finish spreadsheet #work #grocery-list #q3_review');
      expect(tags).toEqual(['work', 'grocery-list', 'q3_review']);
      expect(stripped).toBe('Finish spreadsheet');
    });

    it('detects list or multi-line text accurately via isListOrMultiLine', () => {
      expect(isListOrMultiLine('Single line task')).toBe(false);
      expect(isListOrMultiLine('Task 1\nTask 2')).toBe(true);
      expect(isListOrMultiLine('• Task 1 • Task 2')).toBe(true);
      expect(isListOrMultiLine('- [ ] Task 1')).toBe(true);
      expect(isListOrMultiLine('1. Task 1 2. Task 2')).toBe(true);
      expect(isListOrMultiLine('(1) Task 1 (2) Task 2')).toBe(true);
      expect(isListOrMultiLine('[1] Task 1 [2] Task 2')).toBe(true);
      expect(isListOrMultiLine('- Task 1 - Task 2')).toBe(true);
    });

    it('strictly clamps individual titles to 255 chars to prevent storage crash', () => {
      const superLongTitle = 'A'.repeat(400);
      const draft = compileCapture(superLongTitle, 'inbox', now);
      expect(draft.title.length).toBe(255);
      expect(draft.title).toBe('A'.repeat(255));
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

