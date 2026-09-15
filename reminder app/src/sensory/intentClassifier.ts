/**
 * Remy Reminders - Dual-Stream On-Device Intent Classifier
 * Executes on-device in <0.5ms with zero cloud calls and zero external dependencies.
 * Routes alerts into 3 streams: Actionable To-Do, Deal/Voucher Radar, or Noise,
 * preceded by a strict Stage 0 Security Quarantine Gate.
 */

import {
  ClassificationResult,
  QuarantineReason,
  RawNotificationPayload,
} from './types';
import { parsePromo } from './promoParser';
import { extractDate } from './dateExtractor';

// Stage 0: Strict OTP & Credential Quarantine Patterns
const OTP_KEYWORDS = /\b(?:otp|one[- ]time[- ]password|one[- ]time[- ]pin|verification code|verify code|auth[- ]code|security pin|login pin|secret code|password reset code)\b/i;
const OTP_PHRASES = /\b(?:\d{4,8})\s+(?:is your (?:otp|verification|secret code|one[- ]time|login code)|valid for)|(?:do not share|never share|never disclose)\b/i;
const SENSITIVE_TOKEN_PATTERN = /\b(?:otp|pin|passcode|code)\s*[:=]\s*\d{4,8}\b/i;

// Stage 1: Noise Patterns
const PAST_TRANSACTION_REGEX = /\b(?:paid (?:₹|\$|Rs\.?|INR)|payment of (?:₹|\$|Rs\.?|INR|\d+).*was successful|debited (?:for|by)|debited from|credited (?:with|to)|package delivered|order delivered|handed directly to|delivered:)\b/i;
const SOCIAL_ALERT_REGEX = /\b(?:started following you|liked your|commented on|tagged you|shared a (?:photo|video|post)|trending on)\b/i;
const SYSTEM_ALERT_REGEX = /\b(?:apps? updated successfully|sync complete|download complete|battery (?:fully charged|full|low)|backup finished|storage space running out)\b/i;
const RATING_FEEDBACK_REGEX = /\b(?:rate your (?:order|ride|experience|driver)|how was your|hope you enjoyed your)\b/i;
const CHAT_PACKAGES = new Set([
  'com.whatsapp',
  'org.telegram.messenger',
  'org.thoughtcrime.securesms',
  'com.google.android.talk',
]);

// Actionable Domain Patterns
const DELIVERY_REGEX = /\b(out for delivery|arriving today|will be delivered|package arriving|driver is on the way|on the way to your address|courier out for delivery)\b/i;
const BILL_REGEX = /\b(bill due|payment due|due date:?|amount due|pay before|last date to pay|postpaid bill|electricity bill|recharge expires|water bill|credit card bill)\b/i;
const TRAVEL_REGEX = /\b(web check-in|flight departs|boarding begins|gate closes|train departs)\b/i;
const RIDE_REGEX = /\b(driver .* arriving in|ride arriving|driver is arriving|cab is waiting)\b/i;
const APPOINTMENT_REGEX = /\b(appointment scheduled|doctor appointment|dentist appointment|scheduled for|service booked)\b/i;

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
  'com.makemytrip': 'MakeMyTrip',
  'in.goindigo.android': 'IndiGo',
  'com.airtel.thanks': 'Airtel',
  'com.jio.myjio': 'Jio',
  'com.snapwork.hdfc': 'HDFC Bank',
  'com.sbi.upi': 'SBI',
  'com.icici.bank': 'ICICI Bank',
  'com.dhl.express': 'DHL Express',
  'com.practo.client': 'Practo',
};

/**
 * Checks if notification contains sensitive credentials/OTPs that must never be processed.
 */
export function checkQuarantine(title: string, text: string): { quarantined: boolean; reason?: QuarantineReason } {
  const combined = `${title} ${text}`;
  if (OTP_KEYWORDS.test(combined) || OTP_PHRASES.test(combined) || SENSITIVE_TOKEN_PATTERN.test(combined)) {
    return { quarantined: true, reason: 'SENSITIVE_AUTH_CODE' };
  }
  return { quarantined: false };
}

/**
 * Checks if notification is non-actionable noise.
 */
export function checkNoise(title: string, text: string, pkg?: string): { isNoise: boolean; reason?: 'past_receipt' | 'social' | 'system_status' | 'unactionable' | 'chat' } {
  const combined = `${title} ${text}`;
  if (PAST_TRANSACTION_REGEX.test(combined)) return { isNoise: true, reason: 'past_receipt' };
  if (SOCIAL_ALERT_REGEX.test(combined)) return { isNoise: true, reason: 'social' };
  if (SYSTEM_ALERT_REGEX.test(combined)) return { isNoise: true, reason: 'system_status' };
  if (RATING_FEEDBACK_REGEX.test(combined)) return { isNoise: true, reason: 'unactionable' };

  if (pkg && CHAT_PACKAGES.has(pkg) && !/\b(?:pay|due|flight|pickup|appointment)\b/i.test(combined)) {
    return { isNoise: true, reason: 'chat' };
  }

  return { isNoise: false };
}

function resolveMerchant(title: string, packageName?: string): string {
  if (packageName && PACKAGE_MERCHANT_MAP[packageName]) {
    return PACKAGE_MERCHANT_MAP[packageName];
  }
  if (title.includes(':')) {
    const prefix = title.split(':')[0].trim();
    if (prefix.length <= 25) return prefix;
  }
  if (title.length > 0 && title.length <= 25 && !/bill|order|package|deal|alert/i.test(title)) {
    return title.trim();
  }
  return '';
}

/**
 * Main On-Device Intent Classifier.
 * Guarantees <0.5ms evaluation latency. Zero cloud dependencies.
 */
export function classifyNotification(payload: RawNotificationPayload, now: Date = new Date()): ClassificationResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { title, text, packageName } = payload;

  // Stage 0: Security & OTP Quarantine Gate
  const quarantine = checkQuarantine(title, text);
  if (quarantine.quarantined) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      stream: 'quarantined',
      quarantineReason: quarantine.reason,
      confidence: 1.0,
      evaluationTimeMs: elapsed,
    };
  }

  // Stage 1: Noise Pre-Filter
  const noiseCheck = checkNoise(title, text, packageName);
  if (noiseCheck.isNoise) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      stream: 'noise',
      noise: { reason: noiseCheck.reason! },
      confidence: 0.9,
      evaluationTimeMs: elapsed,
    };
  }

  // Stage 2: Deals & Voucher Radar
  const deal = parsePromo(title, text, packageName, now);
  if (deal && deal.code !== 'DEAL') {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      stream: 'deal',
      deal,
      confidence: deal.confidence,
      evaluationTimeMs: elapsed,
    };
  }

  // Stage 3: Actionable To-Do Engine
  const combined = `${title} ${text}`;
  const merchant = resolveMerchant(title, packageName);

  // 3A. Delivery & Logistics
  if (DELIVERY_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    let itemDesc = 'package';
    const pkgMatch = combined.match(/(?:containing|package of|order of)\s+['"“]?([^'"”.,;\n]+)['"”]?/i);
    if (pkgMatch) {
      itemDesc = `package (${pkgMatch[1].trim()})`;
    }
    const cleanMerchant = merchant || 'courier';
    const cleanTitle = `Receive ${cleanMerchant} ${itemDesc}`;
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: cleanTitle,
        actionVerb: 'Receive',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'delivery',
        tags: ['delivery', 'logistics'],
        confidence: 0.95,
      },
      confidence: 0.95,
      evaluationTimeMs: elapsed,
    };
  }

  // 3B. Utility & Bill Payments
  if (BILL_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    let billType = 'bill';
    if (/electricity/i.test(combined)) billType = 'electricity bill';
    else if (/postpaid/i.test(combined)) billType = 'postpaid bill';
    else if (/water/i.test(combined)) billType = 'water bill';
    else if (/credit card/i.test(combined)) billType = 'credit card bill';

    const cleanTitle = `Pay ${merchant ? `${merchant} ` : ''}${billType}`;
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: cleanTitle,
        actionVerb: 'Pay',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'bill',
        tags: ['bill', 'finance'],
        confidence: 0.95,
      },
      confidence: 0.95,
      evaluationTimeMs: elapsed,
    };
  }

  // 3C. Travel & Flights
  if (TRAVEL_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    const flightMatch = combined.match(/\b(flight\s+[A-Z0-9-]+)\b/i);
    const targetFlight = flightMatch ? flightMatch[1] : 'flight';
    const cleanMerchant = merchant || 'airline';
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: `Web check-in for ${cleanMerchant} ${targetFlight}`,
        actionVerb: 'Check in',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'travel',
        tags: ['travel', 'flight'],
        confidence: 0.9,
      },
      confidence: 0.9,
      evaluationTimeMs: elapsed,
    };
  }

  // 3D. Transport & Rides
  if (RIDE_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    const vehicleMatch = combined.match(/\(([A-Z0-9\s]+)\)/i);
    const vehicleInfo = vehicleMatch ? ` (${vehicleMatch[1].trim()})` : '';
    const cleanMerchant = merchant || 'cab';
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: `Board ${cleanMerchant} ride${vehicleInfo}`,
        actionVerb: 'Board',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'travel',
        tags: ['transport', 'commute'],
        confidence: 0.95,
      },
      confidence: 0.95,
      evaluationTimeMs: elapsed,
    };
  }

  // 3E. Appointments
  if (APPOINTMENT_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: 'Attend appointment',
        actionVerb: 'Attend',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'appointment',
        tags: ['appointment', 'health'],
        confidence: 0.9,
      },
      confidence: 0.9,
      evaluationTimeMs: elapsed,
    };
  }

  // Fallback: If deal had promotional discount without an explicit coupon code
  if (deal) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      stream: 'deal',
      deal,
      confidence: deal.confidence,
      evaluationTimeMs: elapsed,
    };
  }

  // Stage 4: Fallback Noise
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
  return {
    stream: 'noise',
    noise: { reason: 'unactionable' },
    confidence: 0.7,
    evaluationTimeMs: elapsed,
  };
}

export const classifyIntent = classifyNotification;

export const intentClassifier = {
  classify: classifyNotification,
};

export default intentClassifier;
