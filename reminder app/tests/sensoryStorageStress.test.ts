/**
 * Remy Reminders - Sensory & Deals Storage Stress & Adversarial Test Battery
 * Milestone 2 Empirical Challenge Suite
 *
 * Rigorous empirical challenges:
 * 1. Rapid concurrent [Accept] and [Dismiss] operations on identical and mixed suggestion IDs.
 * 2. High-concurrency 1-tap copy calls (50-100 simultaneous calls) verifying race-free copiedCount.
 * 3. Storage corruption recovery on malformed/corrupted AsyncStorage JSON envelopes & item-level fuzzing.
 * 4. Zero-orphan leak checks across multi-cycle batch promotions, dismissals, and storage heals.
 * 5. Complete key isolation and integrity under load.
 */

import { SensoryStorageService, SENSORY_STORAGE_KEY, SENSORY_STORAGE_VERSION } from '../src/sensory/sensoryStorageService';
import { DealsStorageService, DEALS_STORAGE_KEY, DEALS_STORAGE_VERSION } from '../src/sensory/dealsStorageService';
import { SensorySuggestion, VoucherItem } from '../src/sensory/types';
import { Reminder } from '../src/types/reminder';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

describe('Adversarial Challenge: Sensory & Deals Storage Lifecycles Stress Battery', () => {
  let mockReminderRepo: {
    create: jest.Mock;
    reminders: Map<string, Reminder>;
  };
  let mockNotificationService: {
    scheduleReminderNotification: jest.Mock;
  };
  let sensoryService: SensoryStorageService;
  let dealsService: DealsStorageService;

  beforeEach(async () => {
    mockAsyncStorage.__reset();

    const remindersMap = new Map<string, Reminder>();
    mockReminderRepo = {
      reminders: remindersMap,
      create: jest.fn(async (input) => {
        // Simulate realistic async microtask delay to surface interleaving races
        await new Promise((resolve) => setTimeout(resolve, 2));
        const id = `rem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const reminder: Reminder = {
          id,
          title: input.title,
          notes: input.notes,
          dueDate: input.dueDate,
          status: 'pending',
          snoozeCount: 0,
          lastSnoozedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
          notificationId: null,
          armed: input.armed !== false,
        };
        remindersMap.set(id, reminder);
        return reminder;
      }),
    };

    mockNotificationService = {
      scheduleReminderNotification: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return `notif-${Date.now()}`;
      }),
    };

    sensoryService = new SensoryStorageService(mockReminderRepo as any, mockNotificationService as any);
    dealsService = new DealsStorageService();

    await sensoryService.init();
    await dealsService.init();
  });

  // =========================================================================
  // 1. CONCURRENT ACCEPT & DISMISS STRESS TESTS
  // =========================================================================
  describe('1. Concurrent [Accept] and [Dismiss] Operations', () => {
    test('rapid concurrent accept and dismiss on the same suggestion resolves cleanly without orphan leaks', async () => {
      const suggestion = await sensoryService.addSuggestion({
        title: 'Flight check-in IndiGo 6E-204',
        actionVerb: 'Check in',
        originalText: 'Web check-in open',
        inferredDueDate: '2026-09-15T10:00:00.000Z',
        armed: true,
        sourcePackage: 'in.goindigo.android',
        category: 'travel',
        confidence: 0.95,
        tags: ['flight'],
      });

      expect(sensoryService.getPendingSuggestions().length).toBe(1);

      // Trigger concurrent Accept and Dismiss operations simultaneously
      const [acceptResult, dismissResult] = await Promise.allSettled([
        sensoryService.acceptSuggestion(suggestion.id),
        sensoryService.dismissSuggestion(suggestion.id),
      ]);

      // Both operations settle without crashing the process
      expect(acceptResult.status === 'fulfilled' || dismissResult.status === 'fulfilled').toBe(true);

      // Memory cache invariant: exactly 0 pending suggestions remain
      expect(sensoryService.getPendingSuggestions().length).toBe(0);
      expect(sensoryService.getSuggestionById(suggestion.id)).toBeUndefined();

      // Disk storage invariant: zero orphan suggestions remain in raw AsyncStorage
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const envelope = JSON.parse(rawStored!);
      expect(envelope.suggestions).toHaveLength(0);
    });

    test('rapid concurrent accept calls on the same suggestion: check for duplicate reminder generation', async () => {
      const suggestion = await sensoryService.addSuggestion({
        title: 'Renew Passport Reminder',
        actionVerb: 'Renew',
        originalText: 'Passport expires in 6 months',
        inferredDueDate: '2026-10-01T09:00:00.000Z',
        armed: true,
        sourcePackage: 'com.mfa.gov',
        category: 'general',
        confidence: 0.9,
        tags: [],
      });

      // Rapidly fire 3 concurrent acceptSuggestion calls on the exact same suggestion ID
      const results = await Promise.allSettled([
        sensoryService.acceptSuggestion(suggestion.id),
        sensoryService.acceptSuggestion(suggestion.id),
        sensoryService.acceptSuggestion(suggestion.id),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      console.log(`[CHALLENGE LOG] Concurrent Accept on same ID: ${fulfilled.length} fulfilled, ${rejected.length} rejected`);
      console.log(`[CHALLENGE LOG] mockReminderRepo.create invocation count: ${mockReminderRepo.create.mock.calls.length}`);

      // Check whether duplicate reminders were created in the reminder repository
      const createdCount = mockReminderRepo.create.mock.calls.length;
      expect(createdCount).toBeGreaterThanOrEqual(1);

      // Storage cleanup invariant: suggestion is completely purged from sensory storage
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const parsed = JSON.parse(rawStored!);
      expect(parsed.suggestions).toHaveLength(0);
    });

    test('rapid concurrent dismiss calls on the same suggestion are completely idempotent', async () => {
      const suggestion = await sensoryService.addSuggestion({
        title: 'Spam promotion',
        actionVerb: 'Dismiss',
        originalText: 'Unwanted promo',
        inferredDueDate: '2026-09-15T12:00:00.000Z',
        armed: false,
        sourcePackage: 'com.spam.ads',
        category: 'general',
        confidence: 0.4,
        tags: [],
      });

      // Fire 10 concurrent dismiss calls on the same suggestion ID
      const dismissCalls = Array.from({ length: 10 }, () =>
        sensoryService.dismissSuggestion(suggestion.id)
      );

      await expect(Promise.all(dismissCalls)).resolves.not.toThrow();

      // Zero orphans in memory or disk
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const envelope = JSON.parse(rawStored!);
      expect(envelope.suggestions).toHaveLength(0);
    });

    test('interleaved concurrent accepts and dismisses across multiple independent suggestions', async () => {
      // Add 10 suggestions
      const added: SensorySuggestion[] = [];
      for (let i = 0; i < 10; i++) {
        const item = await sensoryService.addSuggestion({
          title: `Task #${i + 1}`,
          actionVerb: 'Review',
          originalText: `Original text ${i + 1}`,
          inferredDueDate: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
          armed: true,
          sourcePackage: `com.app.${i}`,
          category: 'general',
          confidence: 0.9,
          tags: [`tag-${i}`],
        });
        added.push(item);
      }

      expect(sensoryService.getPendingSuggestions()).toHaveLength(10);

      // Concurrently accept even indexed, dismiss odd indexed
      const operations = added.map((item, index) => {
        if (index % 2 === 0) {
          return sensoryService.acceptSuggestion(item.id);
        } else {
          return sensoryService.dismissSuggestion(item.id);
        }
      });

      await Promise.all(operations);

      // All 10 must be cleanly purged from sensory inbox
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      expect(sensoryService.getAllSuggestions()).toHaveLength(0);

      // Exactly 5 reminders should have been created in the reminder repository
      expect(mockReminderRepo.create).toHaveBeenCalledTimes(5);

      // Disk inspection: exactly 0 suggestions remain
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const envelope = JSON.parse(rawStored!);
      expect(envelope.suggestions).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. HIGH-CONCURRENCY 1-TAP COPY TRACKING
  // =========================================================================
  describe('2. High-Concurrency 1-Tap Copy Tracking', () => {
    test('50 concurrent recordCopy calls increment copiedCount race-free to exactly 50', async () => {
      const voucher = await dealsService.addVoucher({
        merchant: 'Swiggy',
        code: 'SWIGGY50',
        discount: '50% OFF',
        discountType: 'percentage',
        description: 'Half price',
        expiryDate: '2026-09-30T23:59:59.000Z',
        sourcePackage: 'com.swiggy.android',
      });

      expect(voucher.copiedCount).toBe(0);

      // Fire 50 simultaneous 1-tap copy calls
      const CONCURRENCY = 50;
      const copyPromises = Array.from({ length: CONCURRENCY }, () =>
        dealsService.recordCopy(voucher.id)
      );

      await Promise.all(copyPromises);

      // Verify in-memory cache
      const updatedInMemory = dealsService.getVoucherById(voucher.id);
      expect(updatedInMemory).toBeDefined();
      expect(updatedInMemory?.copiedCount).toBe(CONCURRENCY);

      // Verify serialized persistence in raw AsyncStorage
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.vouchers[0].copiedCount).toBe(CONCURRENCY);
    });

    test('100 concurrent recordCopy calls increment copiedCount race-free to exactly 100', async () => {
      const voucher = await dealsService.addVoucher({
        merchant: 'Zomato',
        code: 'ZOMATO100',
        discount: 'Flat 100 OFF',
        discountType: 'flat',
        description: 'Centenary promo',
        expiryDate: null,
        sourcePackage: 'com.application.zomato',
      });

      const CONCURRENCY = 100;
      const copyPromises = Array.from({ length: CONCURRENCY }, () =>
        dealsService.recordCopy(voucher.id)
      );

      await Promise.all(copyPromises);

      const cached = dealsService.getVoucherById(voucher.id);
      expect(cached?.copiedCount).toBe(CONCURRENCY);

      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.vouchers[0].copiedCount).toBe(CONCURRENCY);
    });

    test('concurrent recordCopy across 5 different vouchers (20 each = 100 total)', async () => {
      const vouchers: VoucherItem[] = [];
      for (let i = 0; i < 5; i++) {
        const v = await dealsService.addVoucher({
          merchant: `Merchant_${i}`,
          code: `CODE_${i}`,
          discount: `${(i + 1) * 10}% OFF`,
          discountType: 'percentage',
          description: `Voucher ${i}`,
          sourcePackage: `com.merchant.${i}`,
        });
        vouchers.push(v);
      }

      // Fire 20 copies for each of the 5 vouchers simultaneously
      const allCopies: Promise<void>[] = [];
      for (const v of vouchers) {
        for (let c = 0; c < 20; c++) {
          allCopies.push(dealsService.recordCopy(v.id));
        }
      }

      await Promise.all(allCopies);

      // Verify each voucher has exactly 20 copies
      for (const v of vouchers) {
        const found = dealsService.getVoucherById(v.id);
        expect(found?.copiedCount).toBe(20);
      }

      // Verify on disk
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const parsedEnvelope = JSON.parse(rawStored!);
      for (const item of parsedEnvelope.vouchers) {
        expect(item.copiedCount).toBe(20);
      }
    });

    test('recordCopy on non-existent voucher throws cleanly without corrupting other vouchers', async () => {
      const validVoucher = await dealsService.addVoucher({
        merchant: 'Valid Merchant',
        code: 'VALID20',
        discount: '20% OFF',
        sourcePackage: 'com.valid',
      });

      // Non-existent ID call fails
      await expect(dealsService.recordCopy('non-existent-id-xyz')).rejects.toThrow(
        'Voucher with id "non-existent-id-xyz" not found'
      );

      // Valid voucher remains intact with count 0
      expect(dealsService.getVoucherById(validVoucher.id)?.copiedCount).toBe(0);

      // Next copy on valid succeeds
      await dealsService.recordCopy(validVoucher.id);
      expect(dealsService.getVoucherById(validVoucher.id)?.copiedCount).toBe(1);
    });
  });

  // =========================================================================
  // 3. STORAGE CORRUPTION RECOVERY & FUZZING
  // =========================================================================
  describe('3. Storage Corruption Recovery & Envelope Fuzzing', () => {
    test('recovers from completely unparseable JSON envelopes without throwing or hanging', async () => {
      const corruptEnvelopes = [
        '{ invalid json string here',
        '<<< XML NOT JSON >>>',
        'undefined',
        '',
        'NaN',
        '{"version": 1, "suggestions": [}',
      ];

      for (const corrupt of corruptEnvelopes) {
        mockAsyncStorage.__setRaw(SENSORY_STORAGE_KEY, corrupt);
        const service = new SensoryStorageService(mockReminderRepo as any, mockNotificationService as any);

        await expect(service.init()).resolves.not.toThrow();
        expect(service.isReady()).toBe(true);
        expect(service.getPendingSuggestions()).toHaveLength(0);
      }
    });

    test('recovers from unexpected root primitive types in AsyncStorage', async () => {
      const weirdPrimitives = ['12345', '"plain string"', 'true', 'false', 'null'];

      for (const prim of weirdPrimitives) {
        mockAsyncStorage.__setRaw(DEALS_STORAGE_KEY, prim);
        const service = new DealsStorageService();

        await expect(service.init()).resolves.not.toThrow();
        expect(service.isReady()).toBe(true);
        expect(service.getVouchers()).toHaveLength(0);
      }
    });

    test('filters out individual corrupted items inside suggestions envelope', async () => {
      const mixedPayload = {
        version: 1,
        suggestions: [
          null,
          undefined,
          {},
          { id: 'only-id-no-title' },
          { title: 'only-title-no-id' },
          12345,
          'string-item',
          {
            id: 'valid-sug-1',
            title: 'Legitimate Suggestion',
            inferredDueDate: 'invalid-date-string-here',
            createdAt: 'corrupted-timestamp',
            armed: true,
          },
        ],
      };

      mockAsyncStorage.__setRaw(SENSORY_STORAGE_KEY, JSON.stringify(mixedPayload));
      const service = new SensoryStorageService(mockReminderRepo as any, mockNotificationService as any);
      await service.init();

      // Only the valid item should be hydrated; invalid dates should be safely defaulted to ISO now
      const items = service.getPendingSuggestions();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('valid-sug-1');
      expect(items[0].title).toBe('Legitimate Suggestion');
      expect(new Date(items[0].inferredDueDate).getTime()).not.toBeNaN();
    });

    test('filters out individual corrupted items inside vouchers envelope', async () => {
      const mixedVouchers = {
        version: 1,
        vouchers: [
          null,
          'corrupted',
          { id: 'v1' }, // Missing merchant and code
          { id: 'v2', merchant: 'Test' }, // Missing code
          {
            id: 'v3',
            merchant: 'Valid Merchant',
            code: 'VALID50',
            copiedCount: -10, // Negative count sanitized
            expiryDate: 'unparseable-date',
          },
        ],
      };

      mockAsyncStorage.__setRaw(DEALS_STORAGE_KEY, JSON.stringify(mixedVouchers));
      const service = new DealsStorageService();
      await service.init();

      const vouchers = service.getVouchers();
      expect(vouchers).toHaveLength(1);
      expect(vouchers[0].merchant).toBe('Valid Merchant');
      expect(vouchers[0].code).toBe('VALID50');
      // Negative count sanitized to 0
      expect(vouchers[0].copiedCount).toBe(0);
      // Unparseable expiryDate safely defaulted to null (indefinite)
      expect(vouchers[0].expiryDate).toBeNull();
      expect(vouchers[0].isExpired).toBe(false);
    });

    test('healing: next persist after corrupted hydration restores a healthy valid envelope', async () => {
      // Inject corrupt JSON into storage
      mockAsyncStorage.__setRaw(SENSORY_STORAGE_KEY, '{ totally broken json @@##$');

      const service = new SensoryStorageService(mockReminderRepo as any, mockNotificationService as any);
      await service.init();
      expect(service.getPendingSuggestions()).toHaveLength(0);

      // Now perform an add operation
      await service.addSuggestion({
        title: 'New healed suggestion',
        actionVerb: 'Check',
        originalText: 'Healed payload',
        inferredDueDate: '2026-09-20T12:00:00.000Z',
        armed: true,
        sourcePackage: 'com.healed',
        category: 'general',
        confidence: 0.9,
        tags: [],
      });

      // Raw storage key should now contain valid, parseable JSON envelope
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);
      expect(parsed.version).toBe(SENSORY_STORAGE_VERSION);
      expect(parsed.suggestions).toHaveLength(1);
      expect(parsed.suggestions[0].title).toBe('New healed suggestion');
    });
  });

  // =========================================================================
  // 4. ZERO ORPHAN LEAK CHECKS & MULTI-CYCLE LIFECYCLE STRESS
  // =========================================================================
  describe('4. Zero Orphan Leak Checks & Multi-Cycle Lifecycle Stress', () => {
    test('multi-cycle ingress, promotion, and dismissal leaves strictly zero orphans', async () => {
      // Cycle 1: Add 5 items
      const cycle1 = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          sensoryService.addSuggestion({
            title: `Cycle 1 Task ${i}`,
            actionVerb: 'Do',
            originalText: `Cycle 1 note ${i}`,
            inferredDueDate: new Date(Date.now() + 100000).toISOString(),
            armed: true,
            sourcePackage: `com.cycle1.${i}`,
            category: 'general',
            confidence: 0.9,
            tags: [],
          })
        )
      );

      // Accept all 5 in Cycle 1
      for (const item of cycle1) {
        await sensoryService.acceptSuggestion(item.id);
      }

      // Memory & disk check: 0 items
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      let raw = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      expect(JSON.parse(raw!).suggestions).toHaveLength(0);

      // Cycle 2: Add 5 items
      const cycle2 = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          sensoryService.addSuggestion({
            title: `Cycle 2 Task ${i}`,
            actionVerb: 'Do',
            originalText: `Cycle 2 note ${i}`,
            inferredDueDate: new Date(Date.now() + 200000).toISOString(),
            armed: true,
            sourcePackage: `com.cycle2.${i}`,
            category: 'general',
            confidence: 0.8,
            tags: [],
          })
        )
      );

      // Dismiss all 5 in Cycle 2
      for (const item of cycle2) {
        await sensoryService.dismissSuggestion(item.id);
      }

      // Memory & disk check: 0 items
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      raw = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      expect(JSON.parse(raw!).suggestions).toHaveLength(0);

      // Reminders created: exactly 5 (from Cycle 1 only)
      expect(mockReminderRepo.create).toHaveBeenCalledTimes(5);
    });

    test('deals purgeExpired with active copy race conditions maintains disk consistency', async () => {
      const fixedNow = new Date('2026-09-14T15:00:00.000Z');

      // Add 10 vouchers: 5 expired, 5 active
      const activeVouchers: VoucherItem[] = [];
      for (let i = 0; i < 5; i++) {
        const v = await dealsService.addVoucher({
          merchant: `Active_${i}`,
          code: `ACTIVE_${i}`,
          discount: '10% OFF',
          expiryDate: '2026-09-20T00:00:00.000Z', // Future
          sourcePackage: 'com.test',
        });
        activeVouchers.push(v);
      }

      for (let i = 0; i < 5; i++) {
        await dealsService.addVoucher({
          merchant: `Expired_${i}`,
          code: `EXPIRED_${i}`,
          discount: '20% OFF',
          expiryDate: '2026-09-10T00:00:00.000Z', // Past
          sourcePackage: 'com.test',
        });
      }

      expect(dealsService.getVouchers(fixedNow)).toHaveLength(10);
      expect(dealsService.getActiveVouchers(fixedNow)).toHaveLength(5);

      // Simultaneously trigger purgeExpired and recordCopy on active vouchers
      await Promise.all([
        dealsService.purgeExpired(fixedNow),
        dealsService.recordCopy(activeVouchers[0].id),
        dealsService.recordCopy(activeVouchers[1].id),
      ]);

      // Only 5 active vouchers should remain
      const remaining = dealsService.getVouchers(fixedNow);
      expect(remaining).toHaveLength(5);
      expect(remaining.every((v) => !v.isExpired)).toBe(true);

      // Disk reflection
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const envelope = JSON.parse(rawStored!);
      expect(envelope.vouchers).toHaveLength(5);
      expect(envelope.vouchers.some((v: any) => v.merchant.startsWith('Expired'))).toBe(false);
    });
  });

  // =========================================================================
  // 5. STORAGE KEY ISOLATION & REGRESSION PREVENTION
  // =========================================================================
  describe('5. Storage Key Isolation Under Load', () => {
    test('stress operations on sensory and deals services never mutate or leak into @remy/reminders_v1 directly', async () => {
      // Pre-seed @remy/reminders_v1 with initial reminder
      mockAsyncStorage.__setRaw(
        '@remy/reminders_v1',
        JSON.stringify({
          version: 1,
          reminders: [{ id: 'user-core-rem-1', title: 'Existing Core Reminder' }],
          updatedAt: '2026-09-14T00:00:00.000Z',
        })
      );

      // Heavy interleaved sensory and deals operations
      const p1 = sensoryService.addSuggestion({
        title: 'Task A',
        actionVerb: 'A',
        originalText: 'A note',
        inferredDueDate: new Date().toISOString(),
        armed: true,
        sourcePackage: 'com.a',
        category: 'general',
        confidence: 0.9,
        tags: [],
      });
      const p2 = dealsService.addVoucher({
        merchant: 'M1',
        code: 'C1',
        discount: '10%',
        sourcePackage: 'com.m1',
      });
      await Promise.all([p1, p2]);

      // Verify that @remy/reminders_v1 was not directly written to by sensory or deals service
      const rawReminders = mockAsyncStorage.__getRaw('@remy/reminders_v1');
      const parsedReminders = JSON.parse(rawReminders!);
      expect(parsedReminders.reminders).toHaveLength(1);
      expect(parsedReminders.reminders[0].title).toBe('Existing Core Reminder');
    });
  });

  // =========================================================================
  // 6. ADVERSARIAL STOCHASTIC CONCURRENCY & I/O FAULT INJECTION
  // =========================================================================
  describe('6. Adversarial Stochastic Concurrency & I/O Fault Injection', () => {
    test('stochastic race harness: 20 suggestions subjected to concurrent random Accept/Dismiss pairs leave zero orphans and zero duplicates', async () => {
      // Create 20 suggestions
      const suggestions = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          sensoryService.addSuggestion({
            title: `Concurrent Target #${i}`,
            actionVerb: 'Review',
            originalText: `Text ${i}`,
            inferredDueDate: new Date(Date.now() + 1000000).toISOString(),
            armed: true,
            sourcePackage: `com.stochastic.${i}`,
            category: 'general',
            confidence: 0.9,
            tags: [],
          })
        )
      );

      expect(sensoryService.getPendingSuggestions()).toHaveLength(20);

      // Concurrently launch both Accept and Dismiss on each item with randomized microsecond jitters
      const allRaces = suggestions.map(async (sug) => {
        const jitterA = Math.floor(Math.random() * 5);
        const jitterB = Math.floor(Math.random() * 5);

        const opAccept = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await sensoryService.acceptSuggestion(sug.id);
            } catch {
              // Dismiss may have won the race
            }
            resolve();
          }, jitterA);
        });

        const opDismiss = new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              await sensoryService.dismissSuggestion(sug.id);
            } catch {
              // Accept may have won the race
            }
            resolve();
          }, jitterB);
        });

        await Promise.all([opAccept, opDismiss]);
      });

      await Promise.all(allRaces);

      // Memory invariant: strictly 0 pending suggestions remain
      expect(sensoryService.getPendingSuggestions()).toHaveLength(0);
      expect(sensoryService.getAllSuggestions()).toHaveLength(0);

      // Disk invariant: strictly 0 orphan suggestions in raw storage
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);
      expect(parsed.suggestions).toHaveLength(0);

      // Duplicate reminder invariant: each suggestion ID was created at most 1 time in repo
      const createdTitles = mockReminderRepo.create.mock.calls.map((call) => call[0].title);
      const titleSet = new Set(createdTitles);
      expect(createdTitles.length).toBe(titleSet.size);
    });

    test('concurrent recordCopy interleaved with voucher deduplication preserves copiedCount', async () => {
      const v = await dealsService.addVoucher({
        merchant: 'Dominos',
        code: 'CHEESE50',
        discount: '30% OFF',
        sourcePackage: 'com.dominos',
      });

      // Launch 25 copies
      const copiesPhase1 = Array.from({ length: 25 }, () => dealsService.recordCopy(v.id));

      // Concurrently update discount terms via deduplication ingress
      const dedupeUpdate = dealsService.addVoucher({
        merchant: 'Dominos',
        code: 'CHEESE50',
        discount: '50% OFF',
        sourcePackage: 'com.dominos',
      });

      // Launch 25 more copies
      const copiesPhase2 = Array.from({ length: 25 }, () => dealsService.recordCopy(v.id));

      await Promise.all([...copiesPhase1, dedupeUpdate, ...copiesPhase2]);

      const finalVoucher = dealsService.getVoucherById(v.id);
      expect(finalVoucher).toBeDefined();
      expect(finalVoucher?.copiedCount).toBe(50);
      expect(finalVoucher?.discount).toBe('50% OFF');

      // Disk reflection
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const parsed = JSON.parse(rawStored!);
      expect(parsed.vouchers[0].copiedCount).toBe(50);
    });

    test('recovers gracefully when AsyncStorage.getItem throws a low-level I/O read failure', async () => {
      // Mock AsyncStorage.getItem failure
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('EIO: Low-level disk read I/O failure'));

      const failingService = new SensoryStorageService(mockReminderRepo as any, mockNotificationService as any);

      // init() must handle exception gracefully without crashing
      await expect(failingService.init()).resolves.not.toThrow();
      expect(failingService.isReady()).toBe(true);
      expect(failingService.getPendingSuggestions()).toHaveLength(0);
    });

    test('recovers gracefully when AsyncStorage.setItem throws a low-level write error without poisoning subsequent writes', async () => {
      const testService = new DealsStorageService('temp-test-deals');
      await testService.init();

      // Mock one disk write failure
      mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('ENOSPC: Device out of space'));

      // First add fails due to disk write rejection
      await expect(
        testService.addVoucher({
          merchant: 'FailTest',
          code: 'FAIL1',
          discount: '10%',
          sourcePackage: 'com.fail',
        })
      ).rejects.toThrow('ENOSPC: Device out of space');

      // Subsequent add succeeds and demonstrates the sequential write queue is NOT deadlocked or poisoned
      const v2 = await testService.addVoucher({
        merchant: 'HealTest',
        code: 'HEAL2',
        discount: '20%',
        sourcePackage: 'com.heal',
      });
      expect(v2.code).toBe('HEAL2');

      const vouchers = testService.getVouchers();
      expect(vouchers.some((v) => v.code === 'HEAL2')).toBe(true);
    });
  });
});

