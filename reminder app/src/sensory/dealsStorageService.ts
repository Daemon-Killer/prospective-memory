/**
 * Remy Reminders - Deals & Voucher Storage Service
 * Isolated storage for merchant discount vouchers and promo codes.
 * Storage Key: @remy/deals_vouchers_v1
 *
 * Features:
 * 1. 0ms in-memory cache with synchronous reads for DealsRadarScreen.
 * 2. Dynamic expiry evaluation: isExpired(voucher, now) with safe date parsing.
 * 3. 1-tap copy tracking: recordCopy(id) increments copiedCount and updates timestamp.
 * 4. Auto-expiry maintenance: purgeExpired(now) cleans up stale vouchers.
 * 5. Automatic deduplication: updates existing merchant + code entries rather than creating duplicates.
 * 6. Sequential Promise queue persistence preventing disk race conditions.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateUUID } from '../utils/idGenerator';
import {
  VoucherItem,
  DealsVouchersEnvelope,
  DealExtraction,
  RawNotificationPayload,
  IDealsStorageService,
  DiscountType,
} from './types';

export const DEALS_STORAGE_KEY = '@remy/deals_vouchers_v1';
export const DEALS_STORAGE_VERSION = 1;

/**
 * Safely parses unknown date value into an ISO 8601 string.
 */
function parseSafeISO(val: unknown): string | null {
  if (typeof val !== 'string' && typeof val !== 'number' && !(val instanceof Date)) {
    return null;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function createUUID(): string {
  try {
    if (typeof generateUUID === 'function') {
      return generateUUID();
    }
  } catch {
    // fallback below
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type AddVoucherInput = {
  id?: string;
  merchant: string;
  code: string;
  discount?: string;
  discountValue?: number | null;
  discountType?: DiscountType;
  description?: string;
  expiryDate?: string | null;
  sourcePackage?: string;
  sourceAppName?: string;
  rawNotificationText?: string;
  createdAt?: string;
  updatedAt?: string;
  copiedCount?: number;
};

export class DealsStorageService implements IDealsStorageService {
  private cache: Map<string, VoucherItem> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();
  private listeners: Set<() => void> = new Set();

  constructor(private storageKey: string = DEALS_STORAGE_KEY) {}

  /**
   * Initializes and hydrates cache from AsyncStorage.
   * Safe to call multiple times (idempotent, deduplicated).
   */
  init(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(this.storageKey);

        if (raw) {
          const parsed = JSON.parse(raw);
          let items: VoucherItem[] = [];

          if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && Array.isArray(parsed.vouchers)) {
            items = parsed.vouchers;
          }

          for (const item of items) {
            try {
              if (!item || typeof item !== 'object' || !item.id || !item.merchant || !item.code) {
                continue;
              }

              const nowIso = new Date().toISOString();
              const isoCreatedAt = parseSafeISO(item.createdAt) || nowIso;
              const isoUpdatedAt = parseSafeISO(item.updatedAt) || nowIso;
              const isoExpiry = item.expiryDate ? parseSafeISO(item.expiryDate) : null;

              const voucher: VoucherItem = {
                id: String(item.id),
                merchant: String(item.merchant).trim(),
                code: String(item.code).trim().toUpperCase(),
                discount: String(item.discount || '').trim(),
                discountValue: typeof item.discountValue === 'number' ? item.discountValue : null,
                discountType: (item.discountType as DiscountType) || 'other',
                description: item.description ? String(item.description).trim() : '',
                expiryDate: isoExpiry,
                sourcePackage: item.sourcePackage ? String(item.sourcePackage) : 'unknown',
                sourceAppName: item.sourceAppName ? String(item.sourceAppName) : undefined,
                rawNotificationText: item.rawNotificationText ? String(item.rawNotificationText) : '',
                createdAt: isoCreatedAt,
                updatedAt: isoUpdatedAt,
                copiedCount: typeof item.copiedCount === 'number' && item.copiedCount >= 0 ? Math.floor(item.copiedCount) : 0,
              };

              if (!this.cache.has(voucher.id)) {
                this.cache.set(voucher.id, voucher);
              }
            } catch (itemErr) {
              console.warn('DealsStorageService: Skipping corrupted voucher item:', itemErr);
            }
          }
        }

        this.initialized = true;
        this.notifyListeners();
      } catch (error) {
        console.error('DealsStorageService: Error hydrating cache from storage', error);
        this.initialized = true;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Evaluates dynamic expiration state.
   * Indefinite/null expiry vouchers never expire.
   */
  isExpired(voucher: VoucherItem, now: Date = new Date()): boolean {
    if (!voucher.expiryDate) {
      return false;
    }
    const expiryTime = new Date(voucher.expiryDate).getTime();
    if (isNaN(expiryTime)) {
      return false;
    }
    return now.getTime() > expiryTime;
  }

  /**
   * Synchronous 0ms read: Returns all vouchers decorated with dynamic isExpired flag.
   * Sorted: active (non-expired) first, then by createdAt descending.
   */
  getVouchers(now: Date = new Date()): VoucherItem[] {
    return Array.from(this.cache.values())
      .map((v) => ({
        ...v,
        isExpired: this.isExpired(v, now),
      }))
      .sort((a, b) => {
        if (a.isExpired !== b.isExpired) {
          return a.isExpired ? 1 : -1;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  /**
   * Synchronous 0ms read: Returns only active (non-expired) vouchers.
   */
  getActiveVouchers(now: Date = new Date()): VoucherItem[] {
    return this.getVouchers(now).filter((v) => !v.isExpired);
  }

  /**
   * Synchronous 0ms read: Retrieves a single voucher by ID with dynamic isExpired flag.
   */
  getVoucherById(id: string, now: Date = new Date()): VoucherItem | undefined {
    const item = this.cache.get(id);
    if (!item) return undefined;
    return {
      ...item,
      isExpired: this.isExpired(item, now),
    };
  }

  /**
   * Adds or updates a voucher.
   * Deduplication: If a voucher with identical merchant and code exists,
   * updates its terms and expiry date without resetting copiedCount.
   */
  async addVoucher(input: AddVoucherInput): Promise<VoucherItem> {
    if (!this.initialized) {
      await this.init();
    }

    if (!input || !input.merchant || !input.code) {
      throw new Error('Voucher must have a merchant name and promo code');
    }

    const merchant = input.merchant.trim();
    const code = input.code.trim().toUpperCase();

    // Deduplication match
    let existingMatch: VoucherItem | undefined;
    for (const v of this.cache.values()) {
      if (v.merchant.toLowerCase() === merchant.toLowerCase() && v.code === code) {
        existingMatch = v;
        break;
      }
    }

    const nowIso = new Date().toISOString();
    const id = input.id || existingMatch?.id || createUUID();
    const createdAt = input.createdAt ? (parseSafeISO(input.createdAt) ?? nowIso) : (existingMatch?.createdAt ?? nowIso);
    const expiryDate = input.expiryDate !== undefined ? (input.expiryDate ? parseSafeISO(input.expiryDate) : null) : (existingMatch?.expiryDate ?? null);

    const voucher: VoucherItem = {
      id,
      merchant,
      code,
      discount: input.discount ? input.discount.trim() : (existingMatch?.discount ?? ''),
      discountValue: typeof input.discountValue === 'number' ? input.discountValue : (existingMatch?.discountValue ?? null),
      discountType: input.discountType || existingMatch?.discountType || 'other',
      description: input.description !== undefined ? input.description.trim() : (existingMatch?.description ?? ''),
      expiryDate,
      sourcePackage: input.sourcePackage || existingMatch?.sourcePackage || 'unknown',
      sourceAppName: input.sourceAppName || existingMatch?.sourceAppName,
      rawNotificationText: input.rawNotificationText !== undefined ? input.rawNotificationText : (existingMatch?.rawNotificationText ?? ''),
      createdAt,
      updatedAt: nowIso,
      copiedCount: typeof input.copiedCount === 'number' ? input.copiedCount : (existingMatch?.copiedCount ?? 0),
    };

    this.cache.set(id, voucher);
    this.notifyListeners();
    await this.persist();

    return {
      ...voucher,
      isExpired: this.isExpired(voucher),
    };
  }

  /**
   * Ingests from DealExtraction and RawNotificationPayload.
   */
  async addFromExtraction(deal: DealExtraction, raw: RawNotificationPayload): Promise<VoucherItem> {
    return this.addVoucher({
      id: raw.id || createUUID(),
      merchant: deal.merchant,
      code: deal.code,
      discount: deal.discount,
      discountValue: deal.discountValue,
      discountType: deal.discountType,
      description: deal.description,
      expiryDate: deal.expiryDate ?? null,
      sourcePackage: raw.packageName,
      rawNotificationText: raw.text || raw.title || '',
      createdAt: new Date(raw.timestamp || Date.now()).toISOString(),
    });
  }

  /**
   * Increments copiedCount on 1-tap copy and updates timestamp.
   */
  async recordCopy(id: string): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    const voucher = this.cache.get(id);
    if (!voucher) {
      throw new Error(`Voucher with id "${id}" not found`);
    }

    const updated: VoucherItem = {
      ...voucher,
      copiedCount: (voucher.copiedCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    this.cache.set(id, updated);
    this.notifyListeners();
    await this.persist();
  }

  /**
   * Purges all expired vouchers based on current or injected timestamp.
   */
  async purgeExpired(now: Date = new Date()): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }

    let purgedAny = false;
    for (const [id, voucher] of this.cache.entries()) {
      if (this.isExpired(voucher, now)) {
        this.cache.delete(id);
        purgedAny = true;
      }
    }

    if (purgedAny) {
      this.notifyListeners();
      await this.persist();
    }
  }

  /**
   * Deletes a voucher by ID.
   */
  async deleteVoucher(id: string): Promise<boolean> {
    if (!this.initialized) {
      await this.init();
    }

    if (this.cache.has(id)) {
      this.cache.delete(id);
      this.notifyListeners();
      await this.persist();
      return true;
    }
    return false;
  }

  /**
   * Completely clears cache and deletes the storage key.
   */
  async clear(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    this.cache.clear();
    this.initialized = true;
    this.notifyListeners();

    const currentClear = this.flushPromise
      .catch(() => {})
      .then(async () => {
        await AsyncStorage.removeItem(this.storageKey);
      });

    this.flushPromise = currentClear.catch((error) => {
      console.error('DealsStorageService: Error clearing storage', error);
    });

    await currentClear;
  }

  /**
   * Subscribes reactive listener for UI updates.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sequential promise chain persistence.
   */
  private persist(): Promise<void> {
    const currentWrite = this.flushPromise
      .catch(() => {})
      .then(async () => {
        const envelope: DealsVouchersEnvelope = {
          version: DEALS_STORAGE_VERSION,
          vouchers: Array.from(this.cache.values()),
          updatedAt: new Date().toISOString(),
        };
        await AsyncStorage.setItem(this.storageKey, JSON.stringify(envelope));
      });

    this.flushPromise = currentWrite.catch((error) => {
      console.error('DealsStorageService: Error persisting to AsyncStorage', error);
    });

    return currentWrite;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('DealsStorageService: Listener error', e);
      }
    });
  }
}

export const dealsStorageService = new DealsStorageService();
export default dealsStorageService;
