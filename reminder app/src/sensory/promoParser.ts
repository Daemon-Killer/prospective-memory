/**
 * Remy Reminders - Promo & Voucher Extraction Engine
 * Parses promo codes (SAVE50, SWIGGYIT, WELCOME2026), discount terms,
 * and voucher expiry dates with zero external dependencies.
 */

import { DealExtraction, DiscountType } from './types';
import { extractDate } from './dateExtractor';

const PROMO_EXCLUSIONS = new Set([
  'HTTP', 'HTTPS', 'AND', 'THE', 'FOR', 'GET', 'OFF', 'NOW', 'CODE', 'SAVE', 'FLAT',
  'FREE', 'APP', 'ORDER', 'TODAY', 'VALID', 'DEAL', 'USE', 'APPLY', 'INR', 'USD',
  'SMS', 'OTP', 'PIN', 'CARD', 'BANK', 'CASH', 'COUPON', 'VOUCHER', 'DISCOUNT',
  'PROMO', 'OFFER', 'CLICK', 'CHECKOUT', 'TERMS', 'CONDITIONS', 'LIMITED', 'SPECIAL'
]);

// Anti-false-positive pattern for Indian/international vehicle license plates
const VEHICLE_PLATE_REGEX = /^[A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4}$/i;

const PACKAGE_MERCHANT_MAP: Record<string, string> = {
  'com.swiggy.android': 'Swiggy',
  'com.application.zomato': 'Zomato',
  'in.amazon.mShop.android.shopping': 'Amazon',
  'com.amazon.mShop.android.shopping': 'Amazon',
  'com.flipkart.android': 'Flipkart',
  'com.myntra.android': 'Myntra',
  'com.ubercab': 'Uber',
  'com.olacabs.customer': 'Ola',
  'com.dominospizza': "Domino's",
  'com.mcdonalds.app': "McDonald's",
  'com.makemytrip': 'MakeMyTrip',
  'com.airtel.thanks': 'Airtel',
  'com.jio.myjio': 'Jio',
};

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Extracts promotional voucher information from notification text.
 */
export function parsePromo(
  title: string,
  text: string,
  packageName?: string,
  now: Date = new Date()
): DealExtraction | null {
  const combined = `${title} ${text}`;

  // 1. Discount Value Extraction
  let discount: string | null = null;
  let discountValue: number | null = null;
  let discountType: DiscountType = 'other';

  const percentMatch = combined.match(/\b(\d{1,3}%\s*(?:OFF|off|discount)?)\b/i);
  const flatMatch = combined.match(/\b(?:FLAT|flat)\s*(?:₹|Rs\.?|INR|\$)?\s*(\d+)\s*(?:OFF|off)?\b/i);
  const saveMatch = combined.match(/\b(?:SAVE|save)\s*(?:₹|Rs\.?|INR|\$)?\s*(\d+(?:%|\b))/i);
  const currencyOffMatch = combined.match(/\b(?:₹|Rs\.?|INR|\$)\s*(\d+)\s*(?:OFF|off|discount)\b/i);
  const freebieMatch = combined.match(/\b(free delivery|free shipping|buy 1 get 1 free|bogo)\b/i);

  if (percentMatch) {
    discount = percentMatch[1].toUpperCase();
    const val = parseInt(percentMatch[1], 10);
    discountValue = isNaN(val) ? null : val;
    discountType = 'percentage';
  } else if (flatMatch) {
    discount = flatMatch[0].trim();
    discountValue = parseInt(flatMatch[1], 10);
    discountType = 'flat';
  } else if (currencyOffMatch) {
    discount = currencyOffMatch[0].trim();
    discountValue = parseInt(currencyOffMatch[1], 10);
    discountType = 'flat';
  } else if (saveMatch) {
    discount = saveMatch[0].trim();
    discountValue = parseInt(saveMatch[1], 10);
    discountType = saveMatch[1].includes('%') ? 'percentage' : 'flat';
  } else if (freebieMatch) {
    discount = freebieMatch[1];
    discountType = 'freebie';
  }

  // 2. Promo Code Extraction
  let code: string | null = null;

  // Primary trigger: "use code BIRYANI50", "coupon MYNTRA200", "voucher CHEESE150", "apply promo code UBERGO50", "code: SAVE50"
  const triggerMatch = combined.match(
    /(?:(?:use|apply|enter)\s+)?(?:promo\s+code|coupon\s+code|voucher\s+code|coupon|promo|voucher|code|discount\s+code)[:\s=-]+['"“]?([A-Z0-9_-]{3,20})['"”]?/i
  );

  if (triggerMatch && !PROMO_EXCLUSIONS.has(triggerMatch[1].toUpperCase())) {
    code = triggerMatch[1].toUpperCase();
  } else {
    // Secondary trigger: "apply SWIGGYIT at checkout", "use SAVE50 to get"
    const actionCodeMatch = combined.match(
      /(?:use|apply)\s+['"“]?([A-Z0-9_-]{3,20})['"”]?\s+(?:at checkout|to get|for|on your)\b/i
    );
    if (actionCodeMatch && !PROMO_EXCLUSIONS.has(actionCodeMatch[1].toUpperCase())) {
      code = actionCodeMatch[1].toUpperCase();
    } else if (discount) {
      // Standalone code valid only if accompanied by a discount term and not a license plate
      const standaloneMatch = combined.match(/\b([A-Z][A-Z0-9]{2,15}\d[A-Z0-9]*|[A-Z]{3,}\d+)\b/);
      if (standaloneMatch) {
        const candidate = standaloneMatch[1].toUpperCase();
        if (!PROMO_EXCLUSIONS.has(candidate) && !VEHICLE_PLATE_REGEX.test(candidate)) {
          code = candidate;
        }
      }
    }
  }

  // 3. Expiry Date Extraction
  let expiryDate: string | null = null;
  const expiryMatch = combined.match(
    /(?:offer ends?|sale ends?|\bends?\s+(?:on|at|in|by)?|\bexpires?\s+(?:on|at|in|by)?|\bvalid\s+(?:till|until|through))\s+([^.,;!\n]+)/i
  );

  if (expiryMatch) {
    const rawExpiry = expiryMatch[1].replace(/[.,;!]+$/, '').trim();
    const parsed = extractDate(rawExpiry, now);
    if (parsed.rawCue) {
      expiryDate = parsed.date.toISOString();
    } else {
      // Check weekday matches: "ends Sunday", "valid till Friday"
      for (let i = 0; i < 7; i++) {
        if (new RegExp(`\\b${WEEKDAY_NAMES[i]}\\b`, 'i').test(rawExpiry)) {
          const target = new Date(now.getTime());
          const currentDay = target.getDay();
          let diff = i - currentDay;
          if (diff <= 0) diff += 7;
          target.setDate(target.getDate() + diff);
          target.setHours(23, 59, 0, 0);
          expiryDate = target.toISOString();
          break;
        }
      }
    }
  }

  // 4. Merchant Extraction
  let merchant = (packageName && PACKAGE_MERCHANT_MAP[packageName]) || null;
  if (!merchant) {
    const colonIdx = title.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 20) {
      merchant = title.slice(0, colonIdx).trim();
    } else if (title.length <= 25) {
      merchant = title.trim();
    } else {
      merchant = 'Promotions';
    }
  }

  // Must have an explicit code OR a discount with promotional context OR clear promotional offer phrasing
  const hasPromoContext = /\b(?:sales?|offers?|savings?|save|off|coupons?|discounts?|deals?|flat|free|promos?|promotions?|promotional|cashbacks?|vouchers?|exclusive\s+offers?|special\s+offers?|flash\s+sales?|bogo)\b/i.test(combined);
  const hasStrongPromoOffer = /\b(?:special\s+offers?|exclusive\s+offers?|limited\s+period\s+offers?|flash\s+sales?|mega\s+sales?|sales?\s+is\s+live|festive\s+offers?|claim\s+(?:your\s+)?offers?|claim\s+(?:your\s+)?rewards?|deals?\s+of\s+the\s+day|flat\s+discounts?|free\s+delivery|free\s+shipping|bogo|buy\s+1\s+get\s+1)\b/i.test(combined);
  const isDeal = Boolean(code || (discount && discountType !== 'other' && hasPromoContext) || hasStrongPromoOffer || (hasPromoContext && discount));

  if (!isDeal) return null;

  return {
    merchant,
    code: code || 'DEAL',
    discount: discount || 'Special Offer',
    discountValue,
    discountType,
    description: text.trim(),
    expiryDate,
    confidence: code ? 0.95 : 0.8,
  };
}
