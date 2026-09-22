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
  ScamReason,
} from './types';
import { parsePromo } from './promoParser';
import { extractDate } from './dateExtractor';

// Stage 0: Strict OTP & Credential Quarantine Patterns
const OTP_KEYWORDS = /\b(?:otp|one[- ]time[- ]password|one[- ]time[- ]pin|verification code|verify code|auth[- ]code|security pin|login pin|secret code|password reset code)\b/i;
const OTP_PHRASES = /\b(?:\d{4,8})\s+(?:is your (?:otp|verification|secret code|one[- ]time|login code)|valid for)|(?:do not share|never share|never disclose)\b/i;
const SENSITIVE_TOKEN_PATTERN = /\b(?:otp|pin|passcode|code)\s*[:=]\s*\d{4,8}\b/i;

// Strict Guardrails: Genuine Banking Transactional Debits / Credits
export const BANK_TRANSACTION_REGEX = /\b(?:debited (?:for|by|from|with)|credited (?:to|with)|a\/c\s*(?:no\.?)?\s*[\w*xX]+\s*(?:is\s*)?(?:debited|credited)|acct\s*(?:is\s*)?(?:debited|credited)|(?:inr|rs\.?|₹|\$)\s*[\d,]+(?:\.\d{2})?\s*(?:debited|credited)|avail(?:able)?\s*bal(?:ance)?|closing\s*bal(?:ance)?|clear\s*bal(?:ance)?|upi\s*(?:ref|txn|transaction)|spent\s*on\s*(?:credit|debit)?\s*card|atm\s*withdrawn?|pos\s*txn|card\s*ending\s*(?:in\s*)?[\d*xX]{4})\b/i;

export function isBankTransaction(title: string, text: string): boolean {
  const combined = `${title} ${text}`;
  return BANK_TRANSACTION_REGEX.test(combined);
}

// Stage 0.5: Scam & Fraud Detection Patterns
export const LOTTERY_SCAM_REGEX = /\b(?:congratulations|congrats|hurry|lucky winner|dear winner|selected)\b.*(?:won|winner|winning|selected for|claim your)\b.*(?:lottery|jackpot|lucky draw|bumper prize|cash prize|reward prize|kbc|car prize|crore|lakhs?|fortune|award)|\b(?:won|winner of|claim)\s+(?:a\s+)?(?:lottery|jackpot|bumper prize|lucky draw|kbc prize|cash reward|free gift)\b|\b(?:you have won|you won)\s+(?:a\s+)?(?:lottery|jackpot|lucky draw|bumper prize|cash prize|cash reward|reward|prize money|fortune|crore|lakhs?|free\s+(?:iphone|car|bike|cash))\b|\bwon a lucky draw\b|\b(?:kbc|kaun banega crorepati)\b.*(?:lottery|prize|winner|number|head office)|\bclaim your (?:lottery|jackpot|prize money|winnings|free car)\b|\b(?:selected\s+for|win\s+a)\s+(?:free\s+)?(?:iphone|car|bike|tata safari|cash)\b.*(?:click|call|claim)/i;

export const FAKE_KYC_SUSPENSION_REGEX = /\b(?:pan(?: card)?|aadhaar(?: card)?|kyc|(?:bank\s+)?(?:account|a\/c|acct)|sim(?: card)?|netbanking|yono|debit card|credit card)\b.*(?:suspended|blocked|deactivated|expired|restricted|freeze|inactive|terminated)\b.*(?:click|visit|update|verify|call|link|apk|contact)|\b(?:dear (?:customer|user)|urgent:?|notice:?)\b.*(?:pan card|kyc|aadhaar)\b.*(?:suspended|blocked|deactivated|expire|invalid|terminated)|\b(?:update|complete|verify)\s+(?:your\s+)?(?:kyc|pan card|aadhaar)\s+(?:immediately|urgently|today|within \d+ hours?)\s+(?:or|otherwise)\s+(?:your\s+)?(?:account|a\/c|acct|sim|card|services?)\s+(?:will be|is)\s+(?:blocked|suspended|deactivated|closed)|\be[- ]?kyc\s+(?:pending|expired|verification required|suspended)\b|\b(?:yono|sbi|hdfc|icici|axis|pnb|paytm|airtel)\s+(?:account|a\/c|acct|rewards?)\b.*(?:blocked|suspended|update kyc|redeem points.*(?:link|http|bit\.ly))|\byour\s+(?:sbi|hdfc|icici|axis|bank)\s+(?:account|a\/c|acct)\s+(?:has been|is)\s+(?:suspended|blocked)\b/i;

export const DISCONNECTION_THREAT_REGEX = /\b(?:electricity|power|light)\s+(?:power\s+)?(?:will be|to be)\s+(?:disconnect(?:ed)?|cut(?: off)?)\s+(?:tonight|today|by \d+[:.]\d+|\d+\s*(?:pm|am))\b|\b(?:previous|last)\s+month\s+bill\s+not\s+updated.*(?:disconnect|officer|call)|\belectricity (?:officer|helpline|department)\b.*(?:\d{10}|\+91\d{10})|\bpower (?:supply )?(?:will be )?disconnected\b|\belectricity bill\b.*(?:disconnected tonight|contact power officer|call electricity officer)/i;

export const LOAN_TRAP_REGEX = /\b(?:pre[- ]approved|instant)\s+(?:personal\s+)?loan\s+of\s+(?:₹|rs\.?|inr)?\s*[\d,]+\s*(?:approved|disbursed|credited|waiting|ready)\b.*(?:no\s+(?:cibil|documents?|doc|verification|income proof)|without documents?|apply now|click|link)|\b(?:approved\s+loan|claim\s+your\s+loan|get\s+instant\s+cash\s+loan)\b.*(?:no cibil|0% interest|no income proof|click|bit\.ly)|\bcredit card\b.*(?:limit of\s+(?:₹|rs\.?|inr)?\s*[\d,]+).*(?:pre[- ]approved|free|without (?:income proof|documents?)|no annual fee|apply now.*(?:bit\.ly|link|click))|\b(?:instant\s+loan\s+in\s+\d+\s+(?:mins?|minutes?)|paperless\s+loan|loan\s+disbursal\s+pending)\b.*(?:click|apply|link)|\b(?:bad cibil|low cibil)\s+loan\s+approved\b/i;

export const SUSPICIOUS_APK_LINK_REGEX = /\b(?:download|install|update)\b.*\.apk\b|\b(?:whatsapp\s+pink|payment\s+app\s+update|kyc\s+app)\b.*\.apk|\b(?:bit\.ly|tinyurl\.com|is\.gd|cutt\.ly|t\.co|rb\.gy|shorturl\.at|tiny\.cc|cutt\.us|surl\.li)\b.*(?:apk|kyc|pan|winner|loan|claim|bonus|suspend|reward|gift|free|earn|job)|\b(?:apk download|install apk)\b/i;

export const CRYPTO_JOB_SCAM_REGEX = /\b(?:earn|make)\s+(?:₹|rs\.?|inr|\$)?\s*[\d,]+(?:\s*-\s*(?:₹|rs\.?|inr|\$)?\s*[\d,]+)?\s*(?:daily|per day|every day)\s*(?:working from home|work from home|from home|online|part[- ]time)\b|\b(?:part[- ]time\s+job|work(?:ing)?\s+from\s+home)\b.*(?:liking\s+(?:youtube|videos?)|rating\s+(?:hotels?|apps?)|google\s+maps|reviews?).*(?:telegram|whatsapp|\+91|\d{10})|\b(?:guaranteed|assured)\s+(?:returns?|profit)\s+of\s+\d+%\b|\b(?:double\s+your\s+money|multiply\s+investment)\s+in\s+\d+\s+(?:days?|hours?|weeks?)\b|\b(?:crypto\s+mining|bitcoin\s+investment|forex\s+trading\s+signals?)\b.*(?:guaranteed|daily profit|join telegram|telegram channel)|\b(?:work(?:ing)?\s+from\s+home|part[- ]time\s+job)\s+offer.*(?:daily payout|earn up to \d+)/i;

export const GAMBLING_SPAM_REGEX = /\b(?:play\s+online\s+(?:rummy|casino|teen patti|poker)|bet\s+on\s+(?:ipl|cricket|casino))\b.*(?:deposit\s+(?:₹|rs\.?|inr)?\s*\d+|get\s+(?:₹|rs\.?|inr)?\s*\d+\s+free|bonus|bonus\s+code)|\b(?:claim\s+100%\s+deposit\s+bonus|register\s+and\s+get\s+(?:₹|rs\.?|inr)?\s*\d+\s+cash)\b/i;

export const TELEMARKETING_SPAM_REGEX = /\b(?:exclusive\s+plots?|villa\s+plots?|luxury\s+villas?|open\s+plots?)\s+(?:near|at|in)\b.*(?:starting\s+(?:at\s+)?(?:₹|rs\.?|inr)?\s*[\d.]+\s*(?:lakhs?|cr)|call\s+now|book\s+site\s+visit)|\b(?:escorts?|call\s+girls?|massage\s+service)\b.*(?:\d{10}|\+91)|\b(?:free\s+stock\s+tips?|sure\s+shot\s+calls?|jackpot\s+calls?|nifty\s+calls?|banknifty\s+calls?|multibagger\s+stocks?)\b.*(?:join\s+telegram|call\s+now|whatsapp)/i;

export function checkScam(
  title: string,
  text: string,
  _pkg?: string
): { isScam: boolean; reason?: ScamReason } {
  const combined = `${title} ${text}`;
  if (!combined.trim()) return { isScam: false };

  // Guardrail 1: Sensitive authentication tokens / OTPs must never be marked as scam
  if (checkQuarantine(title, text).quarantined) {
    return { isScam: false };
  }

  // Phishing indicators take priority over superficial bank or delivery mentions
  const hasKycSuspension = FAKE_KYC_SUSPENSION_REGEX.test(combined);
  const hasSuspiciousApkOrLink = SUSPICIOUS_APK_LINK_REGEX.test(combined);

  // Guardrail 2: Genuine bank transaction receipts must never be marked as scam,
  // UNLESS they contain fake account suspension or APK/phishing links impersonating a bank.
  if (isBankTransaction(title, text) && !hasKycSuspension && !hasSuspiciousApkOrLink) {
    return { isScam: false };
  }

  // Guardrail 3: Genuine delivery tracking alerts must never be marked as scam,
  // UNLESS they contain suspicious APKs or phishing links.
  if (DELIVERY_REGEX.test(combined) && !hasSuspiciousApkOrLink && !hasKycSuspension) {
    return { isScam: false };
  }

  // Check specific scam categories
  if (LOTTERY_SCAM_REGEX.test(combined)) {
    return { isScam: true, reason: 'lottery_fraud' };
  }
  if (FAKE_KYC_SUSPENSION_REGEX.test(combined)) {
    return { isScam: true, reason: 'fake_kyc_suspension' };
  }
  if (DISCONNECTION_THREAT_REGEX.test(combined)) {
    return { isScam: true, reason: 'disconnection_threat' };
  }
  if (LOAN_TRAP_REGEX.test(combined)) {
    return { isScam: true, reason: 'unauthorized_loan_trap' };
  }
  if (SUSPICIOUS_APK_LINK_REGEX.test(combined)) {
    return { isScam: true, reason: 'suspicious_apk_or_link' };
  }
  if (CRYPTO_JOB_SCAM_REGEX.test(combined)) {
    return { isScam: true, reason: 'crypto_investment_scheme' };
  }
  if (GAMBLING_SPAM_REGEX.test(combined)) {
    return { isScam: true, reason: 'gambling_spam' };
  }
  if (TELEMARKETING_SPAM_REGEX.test(combined)) {
    return { isScam: true, reason: 'aggressive_telemarketing' };
  }

  return { isScam: false };
}

// Stage 1: Noise Patterns
const PAST_TRANSACTION_REGEX = /\b(?:paid (?:₹|\$|Rs\.?|INR)|payment of (?:₹|\$|Rs\.?|INR|\d+).*was successful|debited (?:for|by)|debited from|credited (?:with|to)|package delivered|order delivered|handed directly to|delivered:)\b/i;
const SOCIAL_ALERT_REGEX = /\b(?:started following you|liked your|commented on|tagged you|shared a (?:photo|video|post)|trending on)\b/i;
const SYSTEM_ALERT_REGEX = /\b(?:apps? updated successfully|sync complete|download complete|battery (?:fully charged|full|low)|backup finished|storage space running out)\b/i;
const RATING_FEEDBACK_REGEX = /\b(?:rate your (?:order|ride|experience|driver)|how was your|hope you enjoyed your)\b/i;
const CHAT_PACKAGES = new Set([
  'com.whatsapp',
  'com.whatsapp.w4b',
  'org.telegram.messenger',
  'org.thoughtcrime.securesms',
  'com.google.android.talk',
]);

// Actionable Domain Patterns
const DELIVERY_REGEX = /\b(out for delivery|arriving today|will be delivered|package arriving|driver is on the way|on the way to your address|courier out for delivery|dispatched|in transit|order shipped|package has shipped|package shipped|delivery attempt|package in transit|arriving by|arriving tomorrow|expected delivery|estimated delivery|order delivered|package delivered|shipment delivered|delivered to your|ready for pickup|pickup ready|parcel ready|track delivery|track shipment)\b/i;
const BILL_REGEX = /\b(bill due|payment due|due date:?|amount due|pay before|last date to pay|postpaid bill|electricity bill|recharge expires|recharge due|water bill|credit card bill|emi due|installment due|insurance premium due|broadband bill|gas bill|utility bill|payment reminder|bill generated|subscription renewal|renew before|renew by|rent due|rent is due|fee due|fees due|invoice due|payment pending|pending payment|payment overdue|bill overdue|minimum amount due|statement generated)\b/i;
const TRAVEL_REGEX = /\b(web check-in|check-in is (?:now )?open|boarding (?:begins|starts|now|pass)|gate closes|flight (?:departs|departing|scheduled|delayed|on time)|train (?:departs|departing|scheduled)|pnr\b.*(?:\d{10}|confirmed|status)|train\s+\d+.*departs?|bus departs?|gate change|gate changed|flight.*delayed)\b/i;
const RIDE_REGEX = /\b(driver .* arriving in|ride arriving|driver is arriving|cab is waiting|driver has arrived|captain is on the way)\b/i;
const APPOINTMENT_REGEX = /\b(appointment scheduled|doctor appointment|dentist appointment|scheduled for|service booked|meeting reminder|calendar event|upcoming appointment|consultation scheduled|interview scheduled|visit scheduled|reservation confirmed|call scheduled|appointment reminder|upcoming meeting|zoom meeting|google meet|teams meeting|webex meeting|doctor visit|clinic appointment)\b/i;
const ACTION_ITEM_REGEX = /\b(reminder:?|action required:?|action needed:?|to-do:?|don't forget to|please submit|deadline:?|please remember to|task:?|follow up on|follow-up:?|urgent:?|assignment due|task due)\b/i;
const MISSED_CALL_REGEX = /\b(missed call|missed voice call|missed video call)\b/i;

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
    const promoCheck = parsePromo(title, text, pkg);
    if (!promoCheck) {
      return { isNoise: true, reason: 'chat' };
    }
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
  const combined = `${title} ${text}`;

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

  // Stage 0.5: Scam & Fraud Detection Gate
  const scamCheck = checkScam(title, text, packageName);
  if (scamCheck.isScam) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    return {
      stream: 'scam',
      scam: {
        reason: scamCheck.reason!,
        confidence: 0.98,
      },
      confidence: 0.98,
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

  // 3C. Travel & Flights / Trains
  if (TRAVEL_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    const flightMatch = combined.match(/\b(flight\s+[A-Z0-9-]+)\b/i);
    const trainMatch = combined.match(/\b(train\s+[A-Z0-9-]+|\b[0-9]{5}\b)\b/i);
    const cleanMerchant = merchant || (flightMatch ? 'airline' : (trainMatch ? 'railways' : 'transit'));

    let travelTitle = `Web check-in for ${cleanMerchant} ${flightMatch ? flightMatch[1] : 'flight'}`;
    let travelVerb = 'Check in';
    let travelTags = ['travel', 'flight'];

    if (trainMatch || /train/i.test(combined)) {
      const trainDesc = trainMatch ? trainMatch[1] : 'train';
      travelTitle = `Board ${cleanMerchant} ${trainDesc}`;
      travelVerb = 'Board';
      travelTags = ['travel', 'train'];
    } else if (!flightMatch && !/flight/i.test(combined)) {
      travelTitle = `Board ${cleanMerchant} transit`;
      travelVerb = 'Board';
      travelTags = ['travel', 'transit'];
    }

    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: travelTitle,
        actionVerb: travelVerb,
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'travel',
        tags: travelTags,
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
    let apptTitle = 'Attend appointment';
    let apptVerb = 'Attend';
    let apptTags = ['appointment'];

    if (/doctor|dentist|clinic|hospital/i.test(combined)) {
      apptTitle = merchant ? `Attend ${merchant} appointment` : 'Attend doctor appointment';
      apptTags = ['appointment', 'health'];
    } else if (/interview/i.test(combined)) {
      apptTitle = merchant ? `Attend interview with ${merchant}` : 'Attend interview';
      apptTags = ['appointment', 'work'];
    } else if (/meeting|webinar|call/i.test(combined)) {
      apptTitle = merchant ? `Attend ${merchant} meeting` : 'Attend meeting';
      apptTags = ['appointment', 'meeting'];
    } else if (/reservation/i.test(combined)) {
      apptTitle = merchant ? `Attend reservation at ${merchant}` : 'Attend reservation';
      apptTags = ['appointment', 'reservation'];
    } else if (/service/i.test(combined)) {
      apptTitle = merchant ? `Service booked: ${merchant}` : 'Attend service appointment';
      apptTags = ['appointment', 'service'];
    }

    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: apptTitle,
        actionVerb: apptVerb,
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'appointment',
        tags: apptTags,
        confidence: 0.9,
      },
      confidence: 0.9,
      evaluationTimeMs: elapsed,
    };
  }

  // 3F. General Action Items, Tasks & Reminders
  if (ACTION_ITEM_REGEX.test(combined)) {
    const dateInfo = extractDate(combined, now);
    let cleanActionTitle = title || 'Action item';
    if (title.length <= 15 && text.length > 0) {
      const cleanText = text.replace(ACTION_ITEM_REGEX, '').replace(/^[:\s-]+/, '').trim();
      cleanActionTitle = cleanText.length > 0 ? cleanText.slice(0, 60) : title;
    } else {
      cleanActionTitle = title.replace(ACTION_ITEM_REGEX, '').replace(/^[:\s-]+/, '').trim() || title;
    }
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

    return {
      stream: 'actionable',
      actionable: {
        title: cleanActionTitle,
        actionVerb: 'Review',
        context: combined,
        inferredDueDate: dateInfo.date.toISOString(),
        armed: dateInfo.armed,
        category: 'general',
        tags: ['action', 'task'],
        confidence: 0.9,
      },
      confidence: 0.9,
      evaluationTimeMs: elapsed,
    };
  }

  // 3G. Missed Calls
  if (MISSED_CALL_REGEX.test(combined)) {
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    let caller = 'someone';
    
    if (MISSED_CALL_REGEX.test(title)) {
      caller = text || title.replace(MISSED_CALL_REGEX, '').trim();
    } else if (MISSED_CALL_REGEX.test(text)) {
      const textWithoutRegex = text.replace(MISSED_CALL_REGEX, '').replace(/^\s*(?:from|by)?\s+/i, '').trim();
      if (textWithoutRegex.length > 0) {
        caller = textWithoutRegex;
      } else {
        caller = title;
      }
    }
    caller = caller || 'someone';
    
    const dueDate = new Date(now.getTime() + 15 * 60000); // 15 mins later
    
    return {
      stream: 'actionable',
      actionable: {
        title: `Call back ${caller}`,
        actionVerb: 'Call',
        context: combined,
        inferredDueDate: dueDate.toISOString(),
        armed: true,
        category: 'general',
        tags: ['call', 'communication'],
        confidence: 0.99,
      },
      confidence: 0.99,
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
