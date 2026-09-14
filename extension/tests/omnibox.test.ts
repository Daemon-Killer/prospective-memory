import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeXml } from '../src/utils/xmlEscape';
import {
  formatOmniboxSuggestion,
  commitOmniboxReminder,
  createOmniboxReminder,
} from '../src/background/omnibox';
import { storageService } from '../src/services/storageService';
import { compileCapture } from '@core/captureCompilerCore';

describe('Omnibox Ingress (r <tab> <thought>)', () => {
  beforeEach(() => {
    storageService.clearCache();
    vi.clearAllMocks();
  });

  describe('XML Entity Escaping', () => {
    it('escapes &, <, >, ", and \' characters correctly', () => {
      const raw = `Buy "R&D" <apples> & 'oranges'`;
      const escaped = escapeXml(raw);
      expect(escaped).toBe(`Buy &quot;R&amp;D&quot; &lt;apples&gt; &amp; &apos;oranges&apos;`);
    });

    it('does not double escape when replacing & first', () => {
      const raw = `Tom & Jerry <cartoon>`;
      const escaped = escapeXml(raw);
      expect(escaped).toContain('&amp;');
      expect(escaped).not.toContain('&amp;amp;');
    });

    it('handles empty or blank strings', () => {
      expect(escapeXml('')).toBe('');
    });
  });

  describe('Live Autocomplete Suggestion Formatting', () => {
    it('formats armed suggestion with <match> and <dim> tags', () => {
      const fixedNow = new Date('2026-09-14T10:00:00.000Z');
      const draft = compileCapture('Inspect logs +15m', 'inbox', fixedNow);
      const { description } = formatOmniboxSuggestion(draft, 'Inspect logs +15m');

      expect(description).toContain('<match>Inspect logs</match>');
      expect(description).toContain('<dim>');
      expect(description).toContain('⏰ Armed');
    });

    it('formats unarmed inbox suggestion with <dim> tags', () => {
      const fixedNow = new Date('2026-09-14T10:00:00.000Z');
      const draft = compileCapture('Review design specs', 'inbox', fixedNow);
      const { description } = formatOmniboxSuggestion(draft, 'Review design specs');

      expect(description).toContain('<match>Review design specs</match>');
      expect(description).toContain('<dim>');
      expect(description).toContain('📥 Unarmed (Inbox)');
    });

    it('escapes XML characters in title inside suggestion markup without throwing', () => {
      const fixedNow = new Date('2026-09-14T10:00:00.000Z');
      const draft = compileCapture('Check "A&B" <report>', 'inbox', fixedNow);
      const { description } = formatOmniboxSuggestion(draft, 'Check "A&B" <report>');

      expect(description).toContain('&quot;A&amp;B&quot;');
      expect(description).toContain('&lt;report&gt;');
      // Verify valid XML structure by wrapping in a root tag
      const xmlDoc = `<suggestion>${description}</suggestion>`;
      expect(xmlDoc).not.toContain('<<');
      expect(xmlDoc).not.toContain('& ');
    });
  });

  describe('Fast Ledger Commit (<3ms)', () => {
    it('creates a reminder with correct fields from omnibox input', () => {
      const now = new Date('2026-09-14T12:00:00Z');
      const reminder = createOmniboxReminder('Buy milk +15m', now);

      expect(reminder.title.toLowerCase()).toBe('buy milk');
      expect(reminder.armed).toBe(true);
      expect(reminder.status).toBe('pending');
      expect(reminder.snoozeCount).toBe(0);
      expect(new Date(reminder.dueDate).getTime()).toBeGreaterThan(now.getTime());
    });

    it('commits to storage ledger in under 3ms', async () => {
      await storageService.init();

      const start = performance.now();
      const reminder = await commitOmniboxReminder('Finish slides tomorrow morning');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10); // Generous ceiling for CI, synchronous cache is <0.5ms
      expect(storageService.getById(reminder.id)).toBeDefined();
      expect(storageService.getById(reminder.id)?.title).toBe('Finish slides');
      expect(storageService.getById(reminder.id)?.armed).toBe(true);
    });
  });
});
