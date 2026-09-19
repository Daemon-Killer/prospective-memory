/**
 * Remy Reminders - Android Notification Sensory Engine Types
 * Pure TypeScript contract definitions for raw ingress alerts,
 * 3-stream classification, extraction payloads, storage entities,
 * and filter preferences.
 */

// ==========================================
// 1. Raw Ingress Envelope
// ==========================================

export interface RawNotificationPayload {
  id: string;              // UUID v4 generated at native/bridge ingress
  key?: string;            // Android StatusBarNotification key for active tray management
  packageName: string;     // e.g. "com.swiggy.android", "in.amazon.mShop.android.shopping"
  title: string;           // Status-bar notification title
  text: string;            // Notification body text
  subText?: string | null; // Subtitle, info text, or summary
  timestamp: number;       // Ingress epoch timestamp (ms)
  postTime: number;        // Notification post time recorded by Android OS (ms)
  category?: string | null;// Android Notification category (e.g. "promo", "msg", "transport")
}

// ==========================================
// 2. Classification Streams & Enumerations
// ==========================================

export type NotificationStreamType = 'actionable' | 'deal' | 'noise' | 'quarantined';

export type SensoryCategory = 
  | 'delivery' 
  | 'bill' 
  | 'travel' 
  | 'personal' 
  | 'appointment' 
  | 'general';

export type DiscountType = 
  | 'percentage' 
  | 'flat' 
  | 'freebie' 
  | 'cashback' 
  | 'tiered' 
  | 'other';

export type QuarantineReason = 
  | 'SENSITIVE_AUTH_CODE' 
  | 'FINANCIAL_OTP' 
  | 'PASSWORD_RESET' 
  | 'CREDENTIAL_OR_PIN' 
  | 'SECURITY_VERIFICATION';

export type NoiseReason = 
  | 'chat' 
  | 'social' 
  | 'past_receipt' 
  | 'system_status' 
  | 'unactionable';

export type FilterMode = 'whitelist' | 'blacklist';

// ==========================================
// 3. Extraction Payloads
// ==========================================

export interface ActionableExtraction {
  title: string;           // Imperative reminder title (e.g. "Receive Amazon package (Wireless Mouse)")
  actionVerb: string;      // Extracted verb (e.g. "Receive", "Pay", "Check in", "Board", "Attend")
  context: string;         // Cleaned contextual snippet
  inferredDueDate: string; // ISO 8601 due date string
  armed: boolean;          // true if a time cue/deadline was inferred; false if general inbox task
  category: SensoryCategory;
  tags: string[];          // Semantic tags (e.g. ["delivery", "amazon"], ["bill", "finance"])
  confidence: number;      // Heuristic score (0.0 to 1.0)
  notes?: string | null;   // Supplementary context for Reminder.notes
}

export interface DealExtraction {
  merchant: string;        // Resolved merchant name (e.g. "Swiggy", "Zomato", "Myntra", "Uber")
  code: string;            // Uppercase promo code (e.g. "SAVE50", "SWIGGYIT", "WELCOME2026")
  discount: string;        // Human-readable discount string (e.g. "50% OFF", "Flat ₹200 OFF")
  discountValue?: number | null; // Normalized numeric magnitude for sorting (e.g. 50, 200)
  discountType: DiscountType;    // Categorized discount structure
  description: string;     // Concise offer description
  expiryDate?: string | null;    // ISO 8601 expiry timestamp, or null if indefinite
  terms?: string | null;   // e.g. "on orders over ₹1499"
  confidence: number;      // Heuristic score (0.0 to 1.0)
}

export interface NoiseExtraction {
  reason: NoiseReason;
}

export interface ClassificationResult {
  stream: NotificationStreamType;
  actionable?: ActionableExtraction;
  deal?: DealExtraction;
  noise?: NoiseExtraction;
  quarantineReason?: QuarantineReason;
  confidence: number;
  evaluationTimeMs: number; // Sub-millisecond execution duration
}

// ==========================================
// 4. Persistence & Review Queue Entities
// ==========================================

export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface SensorySuggestion {
  id: string;              // UUID v4
  key?: string;            // Android StatusBarNotification key
  title: string;           // Actionable title
  actionVerb: string;      // Action verb
  originalText: string;    // Redacted notification text
  notes?: string | null;   // Notes
  inferredDueDate: string; // ISO 8601 target due date
  armed: boolean;          // OS alarm armed status
  sourcePackage: string;   // Package name
  sourceAppName?: string;  // Friendly name
  category: SensoryCategory;
  confidence: number;
  tags: string[];
  createdAt: string;       // ISO 8601
  status: SuggestionStatus;
}

export interface SensorySuggestionsEnvelope {
  version: number;
  suggestions: SensorySuggestion[];
  updatedAt: string;
}

export interface VoucherItem {
  id: string;              // UUID v4
  merchant: string;        // Merchant name
  code: string;            // Promo code
  discount: string;        // Formatted discount string
  discountValue?: number | null;
  discountType: DiscountType;
  description: string;
  expiryDate: string | null; // ISO 8601 or null
  sourcePackage: string;
  sourceAppName?: string;
  rawNotificationText: string;
  createdAt: string;
  updatedAt: string;
  copiedCount: number;     // Incremented on 1-tap copy
  isExpired?: boolean;     // Dynamic computation
}

export interface DealsVouchersEnvelope {
  version: number;
  vouchers: VoucherItem[];
  updatedAt: string;
}

export interface SensoryFilterConfig {
  mode: FilterMode;
  packages: string[];
  whitelistedPackages?: string[];
  blacklistedPackages?: string[];
  enableOtpQuarantine: boolean;
  ignoreOngoing: boolean;
  enabled?: boolean;
  autoClearPromos?: boolean;
  autoSnoozeNoise?: boolean;
}

// ==========================================
// 5. Service Interfaces
// ==========================================

export interface IIntentClassifier {
  classify(payload: RawNotificationPayload, now?: Date): ClassificationResult;
}

export interface IPromoParser {
  parse(title: string, text: string, packageName?: string, now?: Date): DealExtraction | null;
}

export interface IDateExtractor {
  extract(text: string, now?: Date): { date: Date; armed: boolean; rawCue: string | null };
}

export interface ISensoryStorageService {
  getPendingSuggestions(): SensorySuggestion[];
  acceptSuggestion(id: string): Promise<any>; // Promotes to storageService.create
  dismissSuggestion(id: string): Promise<void>; // Purges suggestion cleanly
}

export interface IDealsStorageService {
  getVouchers(): VoucherItem[];
  recordCopy(id: string): Promise<void>;
  purgeExpired(): Promise<void>;
}

export interface QuarantineStats {
  quarantinedCount: number;
  lastQuarantinedAt: number | null;
}

export interface ISensoryBridge {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getPendingNotifications(): Promise<RawNotificationPayload[]>;
  clearPendingNotifications(): Promise<boolean>;
  drainPendingNotifications(): Promise<RawNotificationPayload[]>;
  getFilterConfig(): Promise<SensoryFilterConfig>;
  updateFilterConfig(config: SensoryFilterConfig): Promise<boolean>;
  getQuarantineStats(): Promise<QuarantineStats>;
  clearQuarantineStats(): Promise<boolean>;
  simulateNotification(payload?: Partial<RawNotificationPayload> | null): Promise<{ status: string; reason?: string }>;
  onNotification(listener: (notification: RawNotificationPayload) => void): () => void;
  initResumeDrain(callback: (notifications: RawNotificationPayload[]) => void): () => void;

  // Active Tray Management
  dismissNotification(key: string): Promise<boolean>;
  snoozeNotification(key: string, durationMs?: number): Promise<boolean>;
  dismissAllNotifications(): Promise<boolean>;
  setAutoClearPromos(enabled: boolean): Promise<boolean>;
  getAutoClearPromos(): Promise<boolean>;
  setAutoSnoozeNoise(enabled: boolean): Promise<boolean>;
  getAutoSnoozeNoise(): Promise<boolean>;
  getMockDismissedKeys?(): string[];
  getMockSnoozedKeys?(): Array<{ key: string; durationMs: number }>;
  clearMockTray?(): void;
}
