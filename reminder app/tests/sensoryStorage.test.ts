/**
 * Remy Reminders - Sensory & Deals Storage Lifecycle Unit Test Suite
 * Milestone 2 Verification Battery
 *
 * Verifies:
 * 1. SensoryStorageService hydration, error recovery, deduplication.
 * 2. [Accept] Promotion lifecycle: creates valid reminder, schedules alert, cleanly purges candidate.
 * 3. [Dismiss] Clean purge lifecycle: evicts candidate with zero orphans.
 * 4. DealsStorageService hydration, 1-tap copy tracking, dynamic expiry check, and auto-purge.
 * 5. Complete key isolation between @remy/sensory_suggestions_v1, @remy/deals_vouchers_v1, and @remy/reminders_v1.
 */

import { SensoryStorageService, SENSORY_STORAGE_KEY, SENSORY_STORAGE_VERSION } from '../src/sensory/sensoryStorageService';
import { DealsStorageService, DEALS_STORAGE_KEY, DEALS_STORAGE_VERSION } from '../src/sensory/dealsStorageService';
import { SensorySuggestion, VoucherItem } from '../src/sensory/types';
import { Reminder } from '../src/types/reminder';
import { mockAsyncStorage } from './mocks/mockAsyncStorage';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  const { mockAsyncStorage } = require('./mocks/mockAsyncStorage');
  return {
    __esModule: true,
    default: mockAsyncStorage,
  };
});

describe('Milestone 2: Sensory & Deals Storage Lifecycles', () => {
  let mockReminderRepo: any;
  let mockNotificationService: any;
  let sensoryService: SensoryStorageService;
  let dealsService: DealsStorageService;

  beforeEach(async () => {
    mockAsyncStorage.__reset();

    mockReminderRepo = {
      create: jest.fn(async (input) => ({
        id: `rem-${Date.now()}`,
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
      })),
    };

    mockNotificationService = {
      scheduleReminderNotification: jest.fn(async () => 'notif-mock-123'),
    };

    sensoryService = new SensoryStorageService(mockReminderRepo, mockNotificationService);
    dealsService = new DealsStorageService();

    await sensoryService.init();
    await dealsService.init();
  });

  // =========================================================
  // 1. SensoryStorageService - Hydration & Deduplication
  // =========================================================
  describe('SensoryStorageService - Hydration & Ingress', () => {
    it('starts with empty cache when storage key is empty', () => {
      expect(sensoryService.isReady()).toBe(true);
      expect(sensoryService.getPendingSuggestions()).toEqual([]);
      expect(sensoryService.getSuggestions()).toEqual([]);
    });

    it('hydrates suggestions from valid envelope JSON', async () => {
      const storedSuggestion: SensorySuggestion = {
        id: 'sug-1',
        title: 'Receive Amazon package',
        actionVerb: 'Receive',
        originalText: 'Courier out for delivery',
        notes: null,
        inferredDueDate: '2026-09-15T14:00:00.000Z',
        armed: true,
        sourcePackage: 'in.amazon.mShop.android.shopping',
        category: 'delivery',
        confidence: 0.95,
        tags: ['delivery'],
        createdAt: '2026-09-14T10:00:00.000Z',
        status: 'pending',
      };

      mockAsyncStorage.__setRaw(
        SENSORY_STORAGE_KEY,
        JSON.stringify({
          version: SENSORY_STORAGE_VERSION,
          suggestions: [storedSuggestion],
          updatedAt: '2026-09-14T10:00:00.000Z',
        })
      );

      const fresh = new SensoryStorageService(mockReminderRepo, mockNotificationService);
      await fresh.init();

      expect(fresh.getPendingSuggestions().length).toBe(1);
      expect(fresh.getPendingSuggestions()[0].title).toBe('Receive Amazon package');
    });

    it('recovers gracefully from malformed JSON without crashing', async () => {
      mockAsyncStorage.__setRaw(SENSORY_STORAGE_KEY, '{ malformed-json: true ');
      const fresh = new SensoryStorageService(mockReminderRepo, mockNotificationService);
      await expect(fresh.init()).resolves.not.toThrow();
      expect(fresh.getPendingSuggestions()).toEqual([]);
    });

    it('deduplicates repeat alerts with identical package and title', async () => {
      await sensoryService.addSuggestion({
        title: 'Pay HDFC credit card bill',
        actionVerb: 'Pay',
        originalText: 'Bill due on 20 Sep',
        inferredDueDate: '2026-09-20T18:00:00.000Z',
        armed: true,
        sourcePackage: 'com.snapwork.hdfc',
        category: 'bill',
        confidence: 0.95,
        tags: ['bill'],
      });

      // Repeat alert
      await sensoryService.addSuggestion({
        title: 'Pay HDFC credit card bill',
        actionVerb: 'Pay',
        originalText: 'Bill due on 20 Sep - reminder',
        inferredDueDate: '2026-09-20T18:00:00.000Z',
        armed: true,
        sourcePackage: 'com.snapwork.hdfc',
        category: 'bill',
        confidence: 0.98,
        tags: ['bill', 'finance'],
      });

      const pending = sensoryService.getPendingSuggestions();
      expect(pending.length).toBe(1);
      expect(pending[0].confidence).toBe(0.98);
    });
  });

  // =========================================================
  // 2. SensoryStorageService - [Accept] Promotion Lifecycle
  // =========================================================
  describe('SensoryStorageService - [Accept] Promotion Lifecycle', () => {
    it('promotes suggestion to active reminder and cleanly purges suggestion', async () => {
      const added = await sensoryService.addSuggestion({
        title: 'Board IndiGo flight 6E-204',
        actionVerb: 'Board',
        originalText: 'Flight 6E-204 boarding begins at 17:30',
        inferredDueDate: '2026-09-15T17:30:00.000Z',
        armed: true,
        sourcePackage: 'in.goindigo.android',
        category: 'travel',
        confidence: 0.95,
        tags: ['travel'],
      });

      expect(sensoryService.getPendingSuggestions().length).toBe(1);

      // Perform Accept promotion
      const reminder = await sensoryService.acceptSuggestion(added.id);

      // 1. Reminder created with matching fields
      expect(mockReminderRepo.create).toHaveBeenCalledTimes(1);
      expect(mockReminderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Board IndiGo flight 6E-204',
          dueDate: '2026-09-15T17:30:00.000Z',
          armed: true,
        })
      );
      expect(reminder.title).toBe('Board IndiGo flight 6E-204');

      // 2. Notification scheduled
      expect(mockNotificationService.scheduleReminderNotification).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.scheduleReminderNotification).toHaveBeenCalledWith(reminder);

      // 3. Clean purge: 0 orphan suggestions remain in cache
      expect(sensoryService.getPendingSuggestions().length).toBe(0);
      expect(sensoryService.getSuggestionById(added.id)).toBeUndefined();

      // 4. Clean purge: 0 orphan suggestions remain in raw AsyncStorage
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.suggestions.length).toBe(0);
    });

    it('throws error when attempting to accept non-existent suggestion ID', async () => {
      await expect(sensoryService.acceptSuggestion('non-existent-id')).rejects.toThrow(
        'Sensory suggestion with id "non-existent-id" not found'
      );
    });

    it('preserves candidate suggestion in cache if storageService.create fails', async () => {
      mockReminderRepo.create.mockRejectedValueOnce(new Error('Storage I/O failure'));

      const added = await sensoryService.addSuggestion({
        title: 'Critical Task',
        actionVerb: 'Review',
        originalText: 'Alert',
        inferredDueDate: '2026-09-16T10:00:00.000Z',
        armed: true,
        sourcePackage: 'com.test',
        category: 'general',
        confidence: 0.9,
        tags: [],
      });

      await expect(sensoryService.acceptSuggestion(added.id)).rejects.toThrow('Storage I/O failure');

      // Crucial: Item must not be lost if promotion failed!
      expect(sensoryService.getPendingSuggestions().length).toBe(1);
      expect(sensoryService.getSuggestionById(added.id)).toBeDefined();
    });
  });

  // =========================================================
  // 3. SensoryStorageService - [Dismiss] Clean Purge Lifecycle
  // =========================================================
  describe('SensoryStorageService - [Dismiss] Clean Purge Lifecycle', () => {
    it('permanently purges suggestion with zero orphans', async () => {
      const added = await sensoryService.addSuggestion({
        title: 'Unwanted Suggestion',
        actionVerb: 'Dismiss',
        originalText: 'Spam alert',
        inferredDueDate: '2026-09-16T12:00:00.000Z',
        armed: false,
        sourcePackage: 'com.spam',
        category: 'general',
        confidence: 0.5,
        tags: [],
      });

      expect(sensoryService.getPendingSuggestions().length).toBe(1);

      await sensoryService.dismissSuggestion(added.id);

      // Memory cache is empty
      expect(sensoryService.getPendingSuggestions().length).toBe(0);
      expect(sensoryService.getSuggestionById(added.id)).toBeUndefined();

      // Disk storage is empty
      const rawStored = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const parsedEnvelope = JSON.parse(rawStored!);
      expect(parsedEnvelope.suggestions.length).toBe(0);
    });

    it('dismissing an unknown ID is a safe idempotent no-op', async () => {
      await expect(sensoryService.dismissSuggestion('random-id')).resolves.not.toThrow();
    });
  });

  // =========================================================
  // 4. DealsStorageService - Ingress & Deduplication
  // =========================================================
  describe('DealsStorageService - Ingress & Deduplication', () => {
    it('persists a new voucher with copiedCount: 0', async () => {
      const voucher = await dealsService.addVoucher({
        merchant: 'Swiggy',
        code: 'SWIGGYIT',
        discount: '50% OFF',
        discountValue: 50,
        discountType: 'percentage',
        description: 'Up to ₹100 on orders over ₹199',
        expiryDate: '2026-09-20T23:59:59.000Z',
        sourcePackage: 'com.swiggy.android',
      });

      expect(voucher.code).toBe('SWIGGYIT');
      expect(voucher.copiedCount).toBe(0);
      expect(dealsService.getVouchers().length).toBe(1);
    });

    it('deduplicates by updating existing voucher instead of duplicating', async () => {
      await dealsService.addVoucher({
        merchant: 'Zomato',
        code: 'ZOMATO50',
        discount: '40% OFF',
        discountType: 'percentage',
        description: 'Initial offer',
        expiryDate: '2026-09-18T00:00:00.000Z',
        sourcePackage: 'com.application.zomato',
      });

      // User copies the code
      const [first] = dealsService.getVouchers();
      await dealsService.recordCopy(first.id);

      // New notification arrives with improved discount for same merchant and code
      await dealsService.addVoucher({
        merchant: 'Zomato',
        code: 'ZOMATO50',
        discount: '50% OFF',
        discountType: 'percentage',
        description: 'Updated offer',
        expiryDate: '2026-09-22T00:00:00.000Z',
        sourcePackage: 'com.application.zomato',
      });

      const vouchers = dealsService.getVouchers();
      expect(vouchers.length).toBe(1);
      expect(vouchers[0].discount).toBe('50% OFF');
      // Copied count preserved!
      expect(vouchers[0].copiedCount).toBe(1);
    });
  });

  // =========================================================
  // 5. DealsStorageService - 1-Tap Copy Tracking
  // =========================================================
  describe('DealsStorageService - 1-Tap Copy Tracking', () => {
    it('increments copiedCount on copy and updates disk storage', async () => {
      const voucher = await dealsService.addVoucher({
        merchant: 'Myntra',
        code: 'MYNTRA400',
        discount: 'Flat ₹400 OFF',
        discountValue: 400,
        discountType: 'flat',
        description: 'On orders over ₹1999',
        expiryDate: null,
        sourcePackage: 'com.myntra.android',
      });

      expect(voucher.copiedCount).toBe(0);

      await dealsService.recordCopy(voucher.id);
      expect(dealsService.getVoucherById(voucher.id)?.copiedCount).toBe(1);

      await dealsService.recordCopy(voucher.id);
      expect(dealsService.getVoucherById(voucher.id)?.copiedCount).toBe(2);

      // Disk reflection
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const parsed = JSON.parse(rawStored!);
      expect(parsed.vouchers[0].copiedCount).toBe(2);
    });

    it('throws error when recording copy for non-existent voucher', async () => {
      await expect(dealsService.recordCopy('non-existent-voucher')).rejects.toThrow(
        'Voucher with id "non-existent-voucher" not found'
      );
    });
  });

  // =========================================================
  // 6. DealsStorageService - Expiry Checks & Auto-Purge
  // =========================================================
  describe('DealsStorageService - Expiry Checks & Auto-Purge', () => {
    const fixedNow = new Date('2026-09-14T15:00:00.000Z');

    it('correctly evaluates isExpired based on expiryDate', async () => {
      const indefinite = await dealsService.addVoucher({
        merchant: 'Brand A',
        code: 'INDEF10',
        discount: '10% OFF',
        discountType: 'percentage',
        description: 'No expiry',
        expiryDate: null,
        sourcePackage: 'com.a',
      });

      const future = await dealsService.addVoucher({
        merchant: 'Brand B',
        code: 'FUTURE20',
        discount: '20% OFF',
        discountType: 'percentage',
        description: 'Expires tomorrow',
        expiryDate: '2026-09-15T15:00:00.000Z',
        sourcePackage: 'com.b',
      });

      const past = await dealsService.addVoucher({
        merchant: 'Brand C',
        code: 'PAST30',
        discount: '30% OFF',
        discountType: 'percentage',
        description: 'Expired yesterday',
        expiryDate: '2026-09-13T15:00:00.000Z',
        sourcePackage: 'com.c',
      });

      expect(dealsService.isExpired(indefinite, fixedNow)).toBe(false);
      expect(dealsService.isExpired(future, fixedNow)).toBe(false);
      expect(dealsService.isExpired(past, fixedNow)).toBe(true);

      // getActiveVouchers filters out past-due
      const active = dealsService.getActiveVouchers(fixedNow);
      expect(active.length).toBe(2);
      expect(active.map((v) => v.code)).toEqual(expect.arrayContaining(['FUTURE20', 'INDEF10']));
    });

    it('purges expired vouchers from memory and disk storage', async () => {
      await dealsService.addVoucher({
        merchant: 'Old Merchant',
        code: 'OLDEXPIRED',
        discount: '80% OFF',
        discountType: 'percentage',
        description: 'Past promo',
        expiryDate: '2026-09-10T00:00:00.000Z',
        sourcePackage: 'com.old',
      });

      await dealsService.addVoucher({
        merchant: 'Fresh Merchant',
        code: 'FRESHACTIVE',
        discount: '25% OFF',
        discountType: 'percentage',
        description: 'Valid promo',
        expiryDate: '2026-09-25T00:00:00.000Z',
        sourcePackage: 'com.fresh',
      });

      expect(dealsService.getVouchers(fixedNow).length).toBe(2);

      await dealsService.purgeExpired(fixedNow);

      const remaining = dealsService.getVouchers(fixedNow);
      expect(remaining.length).toBe(1);
      expect(remaining[0].code).toBe('FRESHACTIVE');

      // Verify on disk
      const rawStored = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const parsed = JSON.parse(rawStored!);
      expect(parsed.vouchers.length).toBe(1);
      expect(parsed.vouchers[0].code).toBe('FRESHACTIVE');
    });
  });

  // =========================================================
  // 7. Storage Key Isolation
  // =========================================================
  describe('Storage Key Isolation', () => {
    it('maintains strict key isolation between suggestions, deals, and reminders', async () => {
      await sensoryService.addSuggestion({
        title: 'Flight check-in',
        actionVerb: 'Check in',
        originalText: 'Web check-in open',
        inferredDueDate: '2026-09-16T08:00:00.000Z',
        armed: true,
        sourcePackage: 'in.goindigo.android',
        category: 'travel',
        confidence: 0.9,
        tags: ['travel'],
      });

      await dealsService.addVoucher({
        merchant: 'Uber',
        code: 'UBER50',
        discount: '50% OFF',
        discountType: 'percentage',
        description: 'Next 3 rides',
        expiryDate: null,
        sourcePackage: 'com.ubercab',
      });

      const rawSensory = mockAsyncStorage.__getRaw(SENSORY_STORAGE_KEY);
      const rawDeals = mockAsyncStorage.__getRaw(DEALS_STORAGE_KEY);
      const rawReminders = mockAsyncStorage.__getRaw('@remy/reminders_v1');

      expect(rawSensory).toContain('Flight check-in');
      expect(rawSensory).not.toContain('UBER50');

      expect(rawDeals).toContain('UBER50');
      expect(rawDeals).not.toContain('Flight check-in');

      // Reminders key unpolluted
      expect(rawReminders).toBeNull();
    });
  });
});
