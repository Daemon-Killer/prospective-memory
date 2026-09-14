import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeXml } from '../src/utils/xmlEscape';
import {
  formatOmniboxSuggestion,
  createOmniboxReminder,
  commitOmniboxReminder,
} from '../src/background/omnibox';
import { RemyHud } from '../src/content/hud';
import { sanitizeTrackers } from '../src/utils/urlSanitizer';
import {
  NOTIFICATION_BUTTONS,
  createNotificationOptions,
  showNotification,
} from '../src/services/notificationService';
import {
  ONE_HOUR_MS,
  evaluateStartupGate,
  handleAlarmEvent,
  handleStartupGate,
} from '../src/services/alarmService';
import {
  MAX_SYNC_BATCH_SIZE,
  chunkArray,
} from '../src/services/syncService';
import { storageService } from '../src/services/storageService';
import { compileCapture } from '@core/captureCompilerCore';
import { Reminder } from '../src/types/reminder';

describe('Empirical Challenger: Acceptance Criteria Stress Harness (M3, M4, M5)', () => {
  beforeEach(() => {
    storageService.clearCache();
    vi.clearAllMocks();
  });

  // =========================================================================
  // CRITERION 1: Omnibox XML Escaping
  // =========================================================================
  describe('Criterion 1: Omnibox XML Escaping', () => {
    const maliciousInputs = [
      `Buy "R&D" <apples> & 'oranges'`,
      `<<&&>>`,
      `<script>alert("xss")</script>`,
      `<tag attr="val">unescaped</tag>`,
      `<<<>>>&&&"""'''`,
      `Nested <match><dim>fake tags</dim></match>`,
      `<![CDATA[malicious cdata]]>`,
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `Tom & Jerry & Friends <cartoon & fun>`,
      `"Quote" 'Single' <Angle> & Ampersand`,
      `&amp; &lt; &gt; &quot; &apos;`,
      `🚨 Emojis & <Special> Chars ✨ "quoted" 'str'`,
    ];

    it.each(maliciousInputs)('escapes "%s" so that suggestion description is strictly valid XML', (input) => {
      const draft = compileCapture(input, 'inbox', new Date());
      const { description } = formatOmniboxSuggestion(draft, input);

      // Verify the returned suggestion markup
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');

      // The description must be valid XML when enclosed in an XML root tag
      const xmlDocumentString = `<?xml version="1.0" encoding="UTF-8"?><suggestion>${description}</suggestion>`;
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlDocumentString, 'text/xml');

      // Assert no parser errors
      const parserErrors = doc.getElementsByTagName('parsererror');
      expect(parserErrors.length, `XML parser error encountered on input: ${input}\nDescription: ${description}`).toBe(0);

      // Verify root tag
      expect(doc.documentElement.nodeName).toBe('suggestion');

      // Verify match tag exists
      const matchTag = doc.querySelector('match');
      expect(matchTag).not.toBeNull();

      // Verify dim tag exists
      const dimTag = doc.querySelector('dim');
      expect(dimTag).not.toBeNull();
    });

    it('asserts pure escapeXml converts all 5 special XML characters unconditionally', () => {
      const raw = `&<>"'`;
      const escaped = escapeXml(raw);
      expect(escaped).toBe('&amp;&lt;&gt;&quot;&apos;');
      expect(escaped).not.toContain('&amp;amp;');
    });

    it('asserts empty or nullish strings never throw in escapeXml or suggestion formatting', () => {
      expect(escapeXml('')).toBe('');
      // @ts-expect-error test non-string
      expect(escapeXml(null)).toBe('');
      // @ts-expect-error test undefined
      expect(escapeXml(undefined)).toBe('');

      const draft = compileCapture('', 'inbox', new Date());
      expect(() => formatOmniboxSuggestion(draft, '')).not.toThrow();
    });
  });

  // =========================================================================
  // CRITERION 2: Shadow DOM HUD Event Isolation
  // =========================================================================
  describe('Criterion 2: Shadow DOM HUD Event Isolation', () => {
    let hud: RemyHud;

    beforeEach(() => {
      document.body.innerHTML = '';
      hud = new RemyHud();
    });

    afterEach(() => {
      hud.close();
      document.body.innerHTML = '';
    });

    it('simulates host page global listeners (window.addEventListener("keydown", spy, false)) and asserts spy is NOT called when typing in HUD', () => {
      hud.open();
      expect(hud.isVisible()).toBe(true);

      const hostWindowSpy = vi.fn();
      const hostDocSpy = vi.fn();
      const hostBodySpy = vi.fn();

      // Simulate host page global listeners (e.g. Monaco, Google Docs, Figma, Notion)
      window.addEventListener('keydown', hostWindowSpy, false);
      document.addEventListener('keydown', hostDocSpy, false);
      document.body.addEventListener('keydown', hostBodySpy, false);

      const testKeys = [
        { key: 'a', code: 'KeyA' },
        { key: 'b', code: 'KeyB' },
        { key: '1', code: 'Digit1' },
        { key: 'Backspace', code: 'Backspace' },
        { key: ' ', code: 'Space' },
      ];

      for (const keyInfo of testKeys) {
        const keyEvent = new KeyboardEvent('keydown', {
          key: keyInfo.key,
          code: keyInfo.code,
          bubbles: true,
          cancelable: true,
        });

        const stopPropagationSpy = vi.spyOn(keyEvent, 'stopPropagation');
        const stopImmediateSpy = vi.spyOn(keyEvent, 'stopImmediatePropagation');

        window.dispatchEvent(keyEvent);

        expect(stopPropagationSpy).toHaveBeenCalled();
        expect(stopImmediateSpy).toHaveBeenCalled();
      }

      // Assert that NONE of the host page listeners were called
      expect(hostWindowSpy).not.toHaveBeenCalled();
      expect(hostDocSpy).not.toHaveBeenCalled();
      expect(hostBodySpy).not.toHaveBeenCalled();

      // Cleanup listeners
      window.removeEventListener('keydown', hostWindowSpy, false);
      document.removeEventListener('keydown', hostDocSpy, false);
      document.body.removeEventListener('keydown', hostBodySpy, false);
    });

    it('asserts host page global keyup and keypress listeners are also isolated', () => {
      hud.open();

      const hostKeyUpSpy = vi.fn();
      const hostKeyPressSpy = vi.fn();

      window.addEventListener('keyup', hostKeyUpSpy, false);
      window.addEventListener('keypress', hostKeyPressSpy, false);

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keypress', { key: 'a', bubbles: true, cancelable: true }));

      expect(hostKeyUpSpy).not.toHaveBeenCalled();
      expect(hostKeyPressSpy).not.toHaveBeenCalled();

      window.removeEventListener('keyup', hostKeyUpSpy, false);
      window.removeEventListener('keypress', hostKeyPressSpy, false);
    });

    it('asserts that closing the HUD restores host page key handling', () => {
      hud.open();
      hud.close();
      expect(hud.isVisible()).toBe(false);

      const hostWindowSpy = vi.fn();
      window.addEventListener('keydown', hostWindowSpy, false);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));

      expect(hostWindowSpy).toHaveBeenCalledTimes(1);

      window.removeEventListener('keydown', hostWindowSpy, false);
    });
  });

  // =========================================================================
  // CRITERION 3: URL Tracker Sanitizer
  // =========================================================================
  describe('Criterion 3: URL Tracker Sanitizer', () => {
    it('passes complex URLs with mixed tracking parameters and asserts all trackers stripped while preserving queries and hash fragments', () => {
      const complexUrl =
        'https://example.com/search?utm_source=google&q=remy+prospective+memory&utm_medium=cpc&category=productivity&utm_campaign=summer2026&fbclid=IwAR3v_xyz123&sort=recent&gclid=CjwKCAjw&msclkid=778899aabb&page=2&mc_eid=deadbeef#section-filters?view=cards';

      const sanitized = sanitizeTrackers(complexUrl);
      const parsed = new URL(sanitized);

      // Trackers that MUST be deleted
      expect(parsed.searchParams.has('utm_source')).toBe(false);
      expect(parsed.searchParams.has('utm_medium')).toBe(false);
      expect(parsed.searchParams.has('utm_campaign')).toBe(false);
      expect(parsed.searchParams.has('fbclid')).toBe(false);
      expect(parsed.searchParams.has('gclid')).toBe(false);
      expect(parsed.searchParams.has('msclkid')).toBe(false);
      expect(parsed.searchParams.has('mc_eid')).toBe(false);

      // Legitimate query parameters that MUST be preserved
      expect(parsed.searchParams.get('q')).toBe('remy prospective memory');
      expect(parsed.searchParams.get('category')).toBe('productivity');
      expect(parsed.searchParams.get('sort')).toBe('recent');
      expect(parsed.searchParams.get('page')).toBe('2');

      // Hash fragment MUST be preserved exactly
      expect(parsed.hash).toBe('#section-filters?view=cards');
    });

    it('handles any utm_* prefix (utm_term, utm_content, utm_custom, utm_id)', () => {
      const urlWithUtmVariants =
        'https://sub.domain.co.uk:8080/path/to/resource?id=999&utm_term=keyword&utm_content=banner_a&utm_id=camp123&utm_source_platform=web&keep=true';

      const sanitized = sanitizeTrackers(urlWithUtmVariants);
      const parsed = new URL(sanitized);

      expect(parsed.searchParams.has('utm_term')).toBe(false);
      expect(parsed.searchParams.has('utm_content')).toBe(false);
      expect(parsed.searchParams.has('utm_id')).toBe(false);
      expect(parsed.searchParams.has('utm_source_platform')).toBe(false);
      expect(parsed.searchParams.get('id')).toBe('999');
      expect(parsed.searchParams.get('keep')).toBe('true');
      expect(parsed.port).toBe('8080');
      expect(parsed.pathname).toBe('/path/to/resource');
    });

    it('handles mixed case and uppercase tracking parameter keys', () => {
      const upperUrl =
        'https://example.com/test?UTM_SOURCE=twitter&FbClId=123&GCLID=456&MSCLKID=789&valid=yes';

      const sanitized = sanitizeTrackers(upperUrl);
      const parsed = new URL(sanitized);

      expect(parsed.searchParams.has('UTM_SOURCE')).toBe(false);
      expect(parsed.searchParams.has('FbClId')).toBe(false);
      expect(parsed.searchParams.has('GCLID')).toBe(false);
      expect(parsed.searchParams.has('MSCLKID')).toBe(false);
      expect(parsed.searchParams.get('valid')).toBe('yes');
    });

    it('handles URLs without any query parameters or only trackers gracefully', () => {
      expect(sanitizeTrackers('https://example.com/clean-path#header')).toBe('https://example.com/clean-path#header');
      expect(sanitizeTrackers('https://example.com/?utm_source=only')).toBe('https://example.com/');
    });
  });

  // =========================================================================
  // CRITERION 4: Notification Button Limit (<= 2)
  // =========================================================================
  describe('Criterion 4: Notification Button Limit (Chromium maxItems <= 2)', () => {
    it('asserts NOTIFICATION_BUTTONS.length <= 2 strictly', () => {
      expect(NOTIFICATION_BUTTONS.length).toBeLessThanOrEqual(2);
      expect(NOTIFICATION_BUTTONS.length).toBe(2);
      expect(NOTIFICATION_BUTTONS[0].title).toBe('+15m');
      expect(NOTIFICATION_BUTTONS[1].title).toBe('Complete');
    });

    it('asserts options.buttons.length <= 2 strictly on diverse reminder payloads', () => {
      const diverseReminders: Reminder[] = [
        {
          id: 'rem-armed-notes',
          title: 'Deploy microservice to staging',
          notes: 'Ensure env vars are synchronized',
          dueDate: new Date().toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: true,
        },
        {
          id: 'rem-unarmed',
          title: 'Someday read paper',
          dueDate: new Date().toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: false,
        },
        {
          id: 'rem-snoozed',
          title: 'Recurring ping',
          dueDate: new Date().toISOString(),
          status: 'snoozed',
          snoozeCount: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: true,
        },
        {
          id: 'rem-long-title',
          title: 'A'.repeat(1000),
          notes: 'B'.repeat(500),
          dueDate: new Date().toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: true,
        },
        {
          id: 'rem-special-chars',
          title: '<alert> "quotes" & ampersands',
          dueDate: new Date().toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          armed: true,
        },
      ];

      for (const rem of diverseReminders) {
        const options = createNotificationOptions(rem);
        expect(options.buttons).toBeDefined();
        expect(options.buttons!.length).toBeLessThanOrEqual(2);
        expect(options.buttons!.length).toBe(2);
      }
    });

    it('asserts showNotification dispatches chrome.notifications.create with options.buttons.length <= 2', async () => {
      const reminder: Reminder = {
        id: 'test-show-notif',
        title: 'Meeting now',
        dueDate: new Date().toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        armed: true,
      };

      await showNotification(reminder);

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'test-show-notif',
        expect.objectContaining({
          buttons: expect.any(Array),
        }),
        expect.any(Function)
      );

      const createCall = vi.mocked(chrome.notifications.create).mock.calls[0];
      const passedOptions = createCall[1] as chrome.notifications.NotificationOptions;
      expect(passedOptions.buttons).toBeDefined();
      expect(passedOptions.buttons!.length).toBeLessThanOrEqual(2);
    });
  });

  // =========================================================================
  // CRITERION 5: Startup Overdue Gate (> 1h vs <= 1h)
  // =========================================================================
  describe('Criterion 5: Startup Overdue Gate', () => {
    const fixedNowMs = 1770000000000;

    it('asserts ONE_HOUR_MS equals exactly 3,600,000 milliseconds', () => {
      expect(ONE_HOUR_MS).toBe(3600000);
      expect(ONE_HOUR_MS).toBe(60 * 60 * 1000);
    });

    it('suppresses notifications for alarms overdue by > 1 hour (e.g. 61m, 2h, 24h, 30d)', () => {
      const overdueDeltas = [
        61 * 60 * 1000,           // 61 minutes
        120 * 60 * 1000,          // 2 hours
        24 * 60 * 60 * 1000,      // 24 hours
        30 * 24 * 60 * 60 * 1000, // 30 days
      ];

      for (const delta of overdueDeltas) {
        const reminder: Reminder = {
          id: `overdue-${delta}`,
          title: 'Stale task',
          dueDate: new Date(fixedNowMs - delta).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date(fixedNowMs - delta - 1000).toISOString(),
          updatedAt: new Date(fixedNowMs - delta - 1000).toISOString(),
          armed: true,
        };

        const result = evaluateStartupGate(reminder, fixedNowMs);
        expect(result).toBe('suppress');
      }
    });

    it('allows notifications for alarms overdue by <= 1 hour (e.g. 59m, 15m, 1m, 0m)', () => {
      const recentDeltas = [
        0,                // due right now
        60 * 1000,        // 1 minute overdue
        15 * 60 * 1000,   // 15 minutes overdue
        59 * 60 * 1000,   // 59 minutes overdue
      ];

      for (const delta of recentDeltas) {
        const reminder: Reminder = {
          id: `recent-${delta}`,
          title: 'Recent task',
          dueDate: new Date(fixedNowMs - delta).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date(fixedNowMs - delta - 1000).toISOString(),
          updatedAt: new Date(fixedNowMs - delta - 1000).toISOString(),
          armed: true,
        };

        const result = evaluateStartupGate(reminder, fixedNowMs);
        expect(result).toBe('notify');
      }
    });

    it('asserts exact boundary behavior at 3,600,000 ms', () => {
      // Exactly 3,600,000 ms overdue -> <= 1 hour -> notify
      const boundaryNotifyReminder: Reminder = {
        id: 'boundary-notify',
        title: 'Exactly 1 hour overdue',
        dueDate: new Date(fixedNowMs - ONE_HOUR_MS).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(fixedNowMs - ONE_HOUR_MS).toISOString(),
        updatedAt: new Date(fixedNowMs - ONE_HOUR_MS).toISOString(),
        armed: true,
      };
      expect(evaluateStartupGate(boundaryNotifyReminder, fixedNowMs)).toBe('notify');

      // 3,600,001 ms overdue -> > 1 hour -> suppress
      const boundarySuppressReminder: Reminder = {
        id: 'boundary-suppress',
        title: '1ms past 1 hour overdue',
        dueDate: new Date(fixedNowMs - ONE_HOUR_MS - 1).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(fixedNowMs - ONE_HOUR_MS - 1).toISOString(),
        updatedAt: new Date(fixedNowMs - ONE_HOUR_MS - 1).toISOString(),
        armed: true,
      };
      expect(evaluateStartupGate(boundarySuppressReminder, fixedNowMs)).toBe('suppress');
    });

    it('verifies handleStartupGate suppresses notification popups and sets toolbar badge for stale alarms', async () => {
      const now = Date.now();

      const staleReminder: Reminder = {
        id: 'stale-startup-rem',
        title: 'Stale reminder >1h',
        dueDate: new Date(now - (2 * 60 * 60 * 1000)).toISOString(), // 2 hours overdue
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 10000).toISOString(),
        updatedAt: new Date(now - 10000).toISOString(),
        armed: true,
      };

      const freshReminder: Reminder = {
        id: 'fresh-startup-rem',
        title: 'Fresh reminder <=1h',
        dueDate: new Date(now - (20 * 60 * 1000)).toISOString(), // 20 minutes overdue
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date(now - 5000).toISOString(),
        updatedAt: new Date(now - 5000).toISOString(),
        armed: true,
      };

      await storageService.saveReminders([staleReminder, freshReminder]);

      const notifierSpy = vi.fn().mockResolvedValue('notif-id');

      const gateReport = await handleStartupGate(notifierSpy);

      // 2 total overdue
      expect(gateReport.overdueCount).toBe(2);
      // 1 suppressed (>1h)
      expect(gateReport.suppressedCount).toBe(1);
      // 1 notified (<=1h)
      expect(gateReport.notifiedCount).toBe(1);

      // notifierSpy was called ONLY once (for freshReminder)
      expect(notifierSpy).toHaveBeenCalledTimes(1);
      expect(notifierSpy).toHaveBeenCalledWith(freshReminder);

      // Badge count was set to total overdue (2) with Swiss Void orange background #FF4500
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '2' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF4500' });
    });
  });

  // =========================================================================
  // CRITERION 6: Sync Batch Chunking (FastAPI Limit <= 500)
  // =========================================================================
  describe('Criterion 6: Sync Batch Chunking', () => {
    it('asserts MAX_SYNC_BATCH_SIZE is exactly 500', () => {
      expect(MAX_SYNC_BATCH_SIZE).toBe(500);
    });

    it('tests chunkArray with 1,200 items; asserts chunks are [500, 500, 200] and no chunk ever exceeds 500 items', () => {
      const items = Array.from({ length: 1200 }, (_, i) => ({ id: `sync-item-${i}`, value: i }));
      const chunks = chunkArray(items, 500);

      // Assert chunks count
      expect(chunks.length).toBe(3);

      // Assert lengths are strictly [500, 500, 200]
      expect(chunks.map((c) => c.length)).toEqual([500, 500, 200]);

      // Assert no chunk ever exceeds 500 items
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }

      // Assert strict sequence ordering and no dropped/duplicated elements
      const reassembled = chunks.flat();
      expect(reassembled.length).toBe(1200);
      expect(reassembled[0].id).toBe('sync-item-0');
      expect(reassembled[499].id).toBe('sync-item-499');
      expect(reassembled[500].id).toBe('sync-item-500');
      expect(reassembled[999].id).toBe('sync-item-999');
      expect(reassembled[1000].id).toBe('sync-item-1000');
      expect(reassembled[1199].id).toBe('sync-item-1199');
    });

    it('stress-tests chunkArray across boundaries (0, 1, 499, 500, 501, 1000, 1001, 3500)', () => {
      const testCases = [
        { count: 0, expectedLengths: [0] },
        { count: 1, expectedLengths: [1] },
        { count: 499, expectedLengths: [499] },
        { count: 500, expectedLengths: [500] },
        { count: 501, expectedLengths: [500, 1] },
        { count: 1000, expectedLengths: [500, 500] },
        { count: 1001, expectedLengths: [500, 500, 1] },
        { count: 3500, expectedLengths: [500, 500, 500, 500, 500, 500, 500] },
      ];

      for (const tc of testCases) {
        const arr = Array.from({ length: tc.count }, (_, i) => i);
        const result = chunkArray(arr, 500);
        const actualLengths = result.map((c) => c.length);

        expect(actualLengths).toEqual(tc.expectedLengths);

        for (const chunk of result) {
          expect(chunk.length).toBeLessThanOrEqual(500);
        }
      }
    });
  });
});
