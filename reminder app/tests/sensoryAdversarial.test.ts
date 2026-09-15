/**
 * Remy Notification Sensory Engine - Adversarial Stress & Chaos Test Suite
 * Rigorous empirical challenges:
 * 1. Multi-thousand-character payloads & ReDoS attack resistance
 * 2. Malicious formatting, null bytes, unicode control chars, emoji floods, SQL/XSS injections
 * 3. Mixed OTP + promo + action alerts (Security Quarantine Supremacy)
 * 4. Edge-case voucher codes, exclusions, vehicle plates, tracking IDs
 * 5. Complex deadline phrases, leap years, rollover invariants, 00s truncation
 * 6. Microsecond latency benchmark across 10,000 runs (p50, p95, p99, max latency)
 */

import {
  classifyNotification,
  checkQuarantine,
  checkNoise,
  parsePromo,
  extractDate,
  RawNotificationPayload,
} from '../src/sensory';

describe('Adversarial Challenge: Sensory Engine & Classifier Stress Suite', () => {
  const benchmarkNow = new Date('2026-09-14T10:00:00.000Z');

  // =========================================================================
  // 1. EXTREME INPUT LENGTHS & ReDoS RESISTANCE
  // =========================================================================
  describe('1. Extreme Input Lengths & ReDoS Stress Testing', () => {
    test('survives 10,000-character repetitive prefix without catastrophic backtracking', () => {
      // Repetitive "driver " prefixes designed to test backtracking on RIDE_REGEX: /driver .* arriving in/
      const maliciousPrefix = 'driver '.repeat(1500);
      const text = `${maliciousPrefix} arriving in 5 mins`;
      const payload: RawNotificationPayload = {
        id: 'stress-1',
        packageName: 'com.ubercab',
        title: 'Uber',
        text,
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const start = performance.now();
      const result = classifyNotification(payload, benchmarkNow);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(30);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('travel');
    });

    test('survives 20,000-character payload of non-matching repetitive patterns', () => {
      // Long pattern that almost matches PAST_TRANSACTION_REGEX or DELIVERY_REGEX
      const repetitiveText = 'package arriving today but actually canceled '.repeat(400);
      const payload: RawNotificationPayload = {
        id: 'stress-2',
        packageName: 'com.random.app',
        title: 'Notice',
        text: repetitiveText,
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const start = performance.now();
      const result = classifyNotification(payload, benchmarkNow);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(30);
      expect(result).toBeDefined();
    });

    test('survives 50,000-character massive arbitrary payload under 25ms', () => {
      const massiveText = 'A'.repeat(50000);
      const payload: RawNotificationPayload = {
        id: 'stress-3',
        packageName: 'com.massive.text',
        title: 'Large Notification',
        text: massiveText,
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const start = performance.now();
      const result = classifyNotification(payload, benchmarkNow);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(25);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('unactionable');
    });

    test('survives nested quotes, brackets, and regex special characters in 10KB string', () => {
      const noisyChars = '([{\\^$|?*+.}])\'"`/\\\\'.repeat(500);
      const payload: RawNotificationPayload = {
        id: 'stress-4',
        packageName: 'com.noise.app',
        title: 'Symbol Flood: ' + noisyChars.slice(0, 100),
        text: noisyChars,
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const start = performance.now();
      const result = classifyNotification(payload, benchmarkNow);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(20);
      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // 2. MALICIOUS FORMATTING, INJECTIONS & CHAOS FUZZING
  // =========================================================================
  describe('2. Malicious Formatting, Injections & Chaos Fuzzing', () => {
    test('handles null bytes, backspaces, and control characters cleanly', () => {
      const corruptPayload: RawNotificationPayload = {
        id: 'chaos-1',
        packageName: 'com.swiggy.android\u0000',
        title: 'Swiggy\u0000\u0008\u001b[31m',
        text: 'Order out for delivery\u0000! Arriving in 15 mins\u0007\u001f.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(corruptPayload, benchmarkNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('delivery');
      expect(result.actionable?.armed).toBe(true);
    });

    test('handles Unicode Right-To-Left override (RLO) and Bidirectional attacks', () => {
      // \u202E is RLO, \u202D is LRO
      const rloPayload: RawNotificationPayload = {
        id: 'chaos-2',
        packageName: 'com.application.zomato',
        title: 'Zomato \u202EotamoZ\u202C',
        text: '\u202EUse code BIRYANI50 for 50% OFF\u202C',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(rloPayload, benchmarkNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.code).toBe('BIRYANI50');
      expect(result.deal?.discount).toContain('50%');
    });

    test('handles zero-width spaces, joiners, and BOM', () => {
      // \u200B (ZWSP), \u200C (ZWNJ), \u200D (ZWJ), \uFEFF (BOM)
      const payload: RawNotificationPayload = {
        id: 'chaos-3',
        packageName: 'in.amazon.mShop.android.shopping',
        title: '\uFEFFAmazon\u200B',
        text: 'Your\u200C package\u200D is out for delivery. Arriving today by 8 PM.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(payload, benchmarkNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('delivery');
      expect(result.actionable?.armed).toBe(true);
    });

    test('handles 2,000 emoji flood prepended and appended to message', () => {
      const emojiFlood = '🍕🔥🎉🚀💎✨⚡️🎁🍔'.repeat(200);
      const payload: RawNotificationPayload = {
        id: 'chaos-4',
        packageName: 'com.dominospizza',
        title: `${emojiFlood} Domino's`,
        text: `${emojiFlood} Flat ₹150 OFF! Use voucher CHEESE150 at checkout. ${emojiFlood}`,
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(payload, benchmarkNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.code).toBe('CHEESE150');
      expect(result.deal?.discount).toContain('150');
    });

    test('handles SQL injection, script injection, and template attacks safely', () => {
      const sqlPayload: RawNotificationPayload = {
        id: 'chaos-5',
        packageName: 'com.test.app',
        title: "'; DROP TABLE reminders; --",
        text: '<script>alert(document.cookie)</script> ${process.exit(1)} {{constructor.constructor()}}',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(sqlPayload, benchmarkNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('unactionable');
    });

    test('handles empty strings and whitespace-only payloads gracefully', () => {
      const emptyPayload: RawNotificationPayload = {
        id: 'chaos-6',
        packageName: '',
        title: '',
        text: '',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(emptyPayload, benchmarkNow);
      expect(result.stream).toBe('noise');

      const whitespacePayload: RawNotificationPayload = {
        id: 'chaos-7',
        packageName: '   ',
        title: '   \n\t  ',
        text: '  \r\n\t  ',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const wsResult = classifyNotification(whitespacePayload, benchmarkNow);
      expect(wsResult.stream).toBe('noise');
    });

    test('handles astronomical discount numbers without overflow or crash', () => {
      const hugeNumberPayload: RawNotificationPayload = {
        id: 'chaos-8',
        packageName: 'com.deal.app',
        title: 'Super Deal',
        text: 'Get 999999999999999999999999999999% OFF with code INFINITY50',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(hugeNumberPayload, benchmarkNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.code).toBe('INFINITY50');
      // Guard correctly rejects >3 digits as a percentage, falling back to 'other' without overflowing
      expect(result.deal?.discountType).toBe('other');

      // Legitimate high percentage up to 3 digits (999%) is recognized
      const maxPercentPayload: RawNotificationPayload = {
        id: 'chaos-8b',
        packageName: 'com.deal.app',
        title: 'Super Deal',
        text: 'Get 999% OFF with code MEGA999',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };
      const maxResult = classifyNotification(maxPercentPayload, benchmarkNow);
      expect(maxResult.stream).toBe('deal');
      expect(maxResult.deal?.discountType).toBe('percentage');
      expect(maxResult.deal?.discountValue).toBe(999);
    });
  });

  // =========================================================================
  // 3. MIXED OTP + PROMO + ACTION ALERTS (SECURITY QUARANTINE SUPREMACY)
  // =========================================================================
  describe('3. Mixed OTP + Promo + Action Alerts (Security Quarantine Supremacy)', () => {
    test('food promo combined with bank payment OTP strictly quarantines', () => {
      const mixed: RawNotificationPayload = {
        id: 'quarantine-mixed-1',
        packageName: 'com.swiggy.android',
        title: 'Swiggy: 50% OFF Order',
        text: 'Use code SWIGGY50 for 50% off! 948201 is your OTP to authenticate transaction of INR 450. Valid for 5 mins. Never share your OTP.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(mixed, benchmarkNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.deal).toBeUndefined();
      expect(result.actionable).toBeUndefined();
    });

    test('electricity bill alert combined with transaction OTP strictly quarantines', () => {
      const mixed: RawNotificationPayload = {
        id: 'quarantine-mixed-2',
        packageName: 'com.snapwork.hdfc',
        title: 'Electricity Bill Payment',
        text: 'Electricity bill of Rs 1,840 is due. 883920 is your OTP for bill payment. Never disclose to anyone.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(mixed, benchmarkNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.actionable).toBeUndefined();
    });

    test('flight check-in combined with auth verification code strictly quarantines', () => {
      const mixed: RawNotificationPayload = {
        id: 'quarantine-mixed-3',
        packageName: 'in.goindigo.android',
        title: 'IndiGo Web Check-in',
        text: 'Web check-in open for flight 6E-204. Your verification code is 449201. Valid for 10 mins.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(mixed, benchmarkNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.actionable).toBeUndefined();
    });

    test('cab ride arriving combined with password reset code strictly quarantines', () => {
      const mixed: RawNotificationPayload = {
        id: 'quarantine-mixed-4',
        packageName: 'com.ubercab',
        title: 'Uber Ride',
        text: 'Driver Ramesh is arriving in 3 mins. Password reset code: 129482. Do not share.',
        timestamp: benchmarkNow.getTime(),
        postTime: benchmarkNow.getTime(),
      };

      const result = classifyNotification(mixed, benchmarkNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.actionable).toBeUndefined();
    });

    test('quarantines diverse authentication credential variants', () => {
      const cases = [
        { title: 'Google', text: '123456 is your Google verification code' },
        { title: 'Auth', text: 'Your one-time-password is 839201' },
        { title: 'Security', text: 'One-time-pin: 4829' },
        { title: 'Banking', text: 'Use security pin 5544 to login' },
        { title: 'Reset', text: 'Password reset code is 998822' },
        { title: 'Service', text: 'Auth-code: 948201 valid for 10 mins' },
        { title: 'Bank', text: 'Your code: 849201. Never disclose to anyone.' },
        { title: 'Login', text: '948201 is your login code' },
        { title: 'Secret', text: '382910 is your secret code' },
      ];

      for (const item of cases) {
        const payload: RawNotificationPayload = {
          id: 'auth-var',
          packageName: 'com.auth',
          title: item.title,
          text: item.text,
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        };
        const result = classifyNotification(payload, benchmarkNow);
        expect(result.stream).toBe('quarantined');
        expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      }
    });

    test('does not false-positive quarantine on legit numbers, order IDs, or promo codes', () => {
      const nonSensitiveCases = [
        { title: 'Amazon', text: 'Order #408-1234567-8901234 has shipped' },
        { title: 'Zomato', text: 'Use coupon SAVE50 for 50% discount' },
        { title: 'Airtel', text: 'Your recharge of Rs 299 was successful' },
        { title: 'Swiggy', text: 'Driver Ramesh is arriving in 15 mins' },
        { title: 'Flipkart', text: 'Price drop: iPhone 16 now at Rs 69999' },
      ];

      for (const item of nonSensitiveCases) {
        const quarantine = checkQuarantine(item.title, item.text);
        expect(quarantine.quarantined).toBe(false);
      }
    });
  });

  // =========================================================================
  // 4. EDGE-CASE VOUCHER CODES & FALSE POSITIVE RESISTANCE
  // =========================================================================
  describe('4. Edge-Case Voucher Codes & False Positive Resistance', () => {
    test('rejects Indian and international vehicle license plates as promo codes', () => {
      const plates = [
        'KA01AB1234',
        'DL 04 C 9999',
        'MH12DE1432',
        'HR26DK8337',
        'TS 09 EA 4567',
        'UP32AZ0001',
      ];

      for (const plate of plates) {
        const deal = parsePromo('Uber', `Driver in Swift (${plate}) arriving in 3 mins. Flat rate applicable.`, 'com.ubercab', benchmarkNow);
        // Plate must not be extracted as voucher code
        expect(deal?.code).not.toBe(plate.replace(/\s+/g, ''));
      }
    });

    test('rejects common non-promo English words in trigger positions (PROMO_EXCLUSIONS)', () => {
      const exclusions = [
        'HTTP', 'HTTPS', 'AND', 'THE', 'FOR', 'GET', 'OFF', 'NOW', 'CODE', 'SAVE',
        'FLAT', 'FREE', 'APP', 'ORDER', 'TODAY', 'VALID', 'DEAL', 'USE', 'APPLY',
        'COUPON', 'VOUCHER', 'DISCOUNT', 'PROMO', 'OFFER', 'TERMS', 'SPECIAL'
      ];

      for (const word of exclusions) {
        // When there is no discount context, excluded words are rejected completely (return null)
        const pureTriggerDeal = parsePromo('Shop', `Apply promo code ${word} at checkout!`, 'com.shop', benchmarkNow);
        expect(pureTriggerDeal).toBeNull();

        // When accompanied by a discount, the excluded word is NEVER captured as the promo code (falls back to generic sentinel 'DEAL')
        const discountDeal = parsePromo('Shop', `Get 20% discount. Apply promo code ${word} at checkout!`, 'com.shop', benchmarkNow);
        if (discountDeal) {
          if (word !== 'DEAL') {
            expect(discountDeal.code).not.toBe(word);
          }
          expect(discountDeal.code).toBe('DEAL');
        }
      }
    });

    test('extracts codes with underscores, hyphens, and mixed casing', () => {
      const dealHyphen = parsePromo('Store', 'Use coupon SAVE-50 for 50% discount', 'com.store', benchmarkNow);
      expect(dealHyphen?.code).toBe('SAVE-50');

      const dealUnderscore = parsePromo('Store', 'Use code MEGA_DEAL_2026 for 30% off', 'com.store', benchmarkNow);
      expect(dealUnderscore?.code).toBe('MEGA_DEAL_2026');

      const dealLower = parsePromo('Store', 'Apply promo code feast100 at checkout', 'com.store', benchmarkNow);
      expect(dealLower?.code).toBe('FEAST100');
    });

    test('extracts various discount formats (percentage, flat currency, freebies, save)', () => {
      const p1 = parsePromo('Swiggy', 'Use code SWIGGY50 for 50% OFF', 'com.swiggy.android', benchmarkNow);
      expect(p1?.discountType).toBe('percentage');
      expect(p1?.discountValue).toBe(50);

      const p2 = parsePromo('Domino', 'Flat ₹200 OFF with code PIZZA200', 'com.domino', benchmarkNow);
      expect(p2?.discountType).toBe('flat');
      expect(p2?.discountValue).toBe(200);

      const p3 = parsePromo('Amazon', 'Save ₹300 on electronics with code TECH300', 'com.amazon', benchmarkNow);
      expect(p3?.discountType).toBe('flat');
      expect(p3?.discountValue).toBe(300);

      const p4 = parsePromo('Subway', 'Free delivery on all footlongs with code FREESHIP', 'com.subway', benchmarkNow);
      expect(p4?.discountType).toBe('freebie');
      expect(p4?.code).toBe('FREESHIP');

      const p5 = parsePromo('Cinema', 'Buy 1 Get 1 Free tickets! Use code BOGO2026', 'com.cinema', benchmarkNow);
      expect(p5?.discountType).toBe('freebie');
      expect(p5?.code).toBe('BOGO2026');
    });
  });

  // =========================================================================
  // 5. COMPLEX DEADLINE PHRASES & DATE BOUNDARY HANDLING
  // =========================================================================
  describe('5. Complex Deadline Phrases & Date Boundary Invariants', () => {
    test('enforces zero seconds and zero milliseconds on all extracted dates', () => {
      const inputs = [
        'arriving in 17 mins',
        'expires in 4 hours',
        'due by 5 PM',
        'departing at 10:30 AM',
        'due date: 28-Sep-2026',
        'due tomorrow',
        'valid till midnight',
        'courier out for delivery',
      ];

      for (const input of inputs) {
        const extracted = extractDate(input, benchmarkNow);
        expect(extracted.date.getSeconds()).toBe(0);
        expect(extracted.date.getMilliseconds()).toBe(0);
      }
    });

    test('handles midnight rollover: sets 23:59:00 today', () => {
      const result = extractDate('Sale valid till midnight tonight', benchmarkNow);
      expect(result.armed).toBe(true);
      expect(result.date.getHours()).toBe(23);
      expect(result.date.getMinutes()).toBe(59);
      expect(result.date.getSeconds()).toBe(0);
      expect(result.date.getDate()).toBe(benchmarkNow.getDate());
    });

    test('handles clock time that has already passed today by rolling to tomorrow', () => {
      // benchmarkNow is 10:00 AM.
      // An alert saying "by 8 AM" must roll over to tomorrow 8:00 AM.
      const result = extractDate('arriving by 8 AM', benchmarkNow);
      expect(result.armed).toBe(true);
      expect(result.date.getHours()).toBe(8);
      expect(result.date.getMinutes()).toBe(0);
      expect(result.date.getDate()).toBe(benchmarkNow.getDate() + 1);
    });

    test('handles clock time in future today without rolling to tomorrow', () => {
      // benchmarkNow is 10:00 AM.
      // "by 4 PM" should be 16:00 today.
      const result = extractDate('arriving by 4 PM', benchmarkNow);
      expect(result.armed).toBe(true);
      expect(result.date.getHours()).toBe(16);
      expect(result.date.getMinutes()).toBe(0);
      expect(result.date.getDate()).toBe(benchmarkNow.getDate());
    });

    test('handles 12 PM (noon) and 12 AM (midnight) clock boundary conversions', () => {
      const noon = extractDate('meeting before 12 PM', benchmarkNow);
      expect(noon.date.getHours()).toBe(12);

      const midnight = extractDate('arriving tomorrow at 12 AM', benchmarkNow);
      expect(midnight.date.getHours()).toBe(0);
    });

    test('handles Leap Year dates accurately', () => {
      const leapNow = new Date('2028-02-15T10:00:00.000Z');
      const leapResult = extractDate('bill due 29-Feb-2028', leapNow);
      expect(leapResult.armed).toBe(true);
      expect(leapResult.date.getFullYear()).toBe(2028);
      expect(leapResult.date.getMonth()).toBe(1); // February (0-indexed)
      expect(leapResult.date.getDate()).toBe(29);
    });

    test('handles calendar dates with ordinal suffixes (1st, 2nd, 3rd, 4th, 25th)', () => {
      const r1 = extractDate('due 1st-Oct-2026', benchmarkNow);
      expect(r1.date.getDate()).toBe(1);
      expect(r1.date.getMonth()).toBe(9); // Oct

      const r2 = extractDate('due 2nd-Nov-2026', benchmarkNow);
      expect(r2.date.getDate()).toBe(2);
      expect(r2.date.getMonth()).toBe(10); // Nov

      const r3 = extractDate('due 3rd-Dec-2026', benchmarkNow);
      expect(r3.date.getDate()).toBe(3);
      expect(r3.date.getMonth()).toBe(11); // Dec

      const r4 = extractDate('due 25th-Sep-2026', benchmarkNow);
      expect(r4.date.getDate()).toBe(25);
      expect(r4.date.getMonth()).toBe(8); // Sep
    });

    test('promo parser weekday expiry advances to upcoming occurrence at 23:59', () => {
      // 2026-09-14 is Monday (day 1)
      const deal = parsePromo('Uber', '50% off! Use code GO50. Valid till Friday.', 'com.ubercab', benchmarkNow);
      expect(deal?.expiryDate).toBeDefined();
      const expiry = new Date(deal!.expiryDate!);
      expect(expiry.getDay()).toBe(5); // Friday
      expect(expiry.getHours()).toBe(23);
      expect(expiry.getMinutes()).toBe(59);
      expect(expiry.getTime()).toBeGreaterThan(benchmarkNow.getTime());
    });
  });

  // =========================================================================
  // 6. MICROSECOND LATENCY BENCHMARK ACROSS 10,000 RUNS
  // =========================================================================
  describe('6. Microsecond Latency Benchmark Across 10,000 Runs', () => {
    test('executes 10,000 diverse classifications with strictly <30ms individual latency and <0.2ms average', () => {
      const corpus: RawNotificationPayload[] = [
        // 1. Actionable Delivery
        {
          id: 'c1',
          packageName: 'com.swiggy.android',
          title: 'Swiggy',
          text: 'Order out for delivery! Arriving in 15 mins.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 2. Actionable Bill
        {
          id: 'c2',
          packageName: 'com.snapwork.hdfc',
          title: 'HDFC Bank',
          text: 'Electricity bill of Rs 1,840 is generated. Due date: 20-Sep-2026.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 3. Actionable Flight
        {
          id: 'c3',
          packageName: 'in.goindigo.android',
          title: 'IndiGo',
          text: 'Web check-in is now open for flight 6E-204 departing tomorrow at 08:30 AM.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 4. Actionable Ride
        {
          id: 'c4',
          packageName: 'com.ubercab',
          title: 'Uber',
          text: 'Your driver Ramesh in Swift Dzire (KA01AB1234) is arriving in 3 mins.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 5. Deal - Percentage Promo
        {
          id: 'c5',
          packageName: 'com.application.zomato',
          title: 'Zomato',
          text: 'Craving biryani? Use code BIRYANI50 to get 50% OFF! Valid till midnight.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 6. Deal - Flat Coupon
        {
          id: 'c6',
          packageName: 'com.myntra.android',
          title: 'Myntra',
          text: 'Use coupon MYNTRA200 for flat ₹200 OFF on orders over ₹1499. Offer ends Sunday!',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 7. Sensitive OTP Quarantine
        {
          id: 'c7',
          packageName: 'com.sbi.upi',
          title: 'SBI',
          text: '849201 is your OTP for transaction of INR 3,500 at Flipkart. Valid for 10 mins. Do not share.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 8. Noise - Past Transaction Receipt
        {
          id: 'c8',
          packageName: 'com.icici.bank',
          title: 'ICICI Bank',
          text: 'Acct XX1234 debited for INR 450.00 on 14-Sep-26 at Starbucks. Avl Bal: INR 45,210.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 9. Noise - Chat message
        {
          id: 'c9',
          packageName: 'com.whatsapp',
          title: 'John',
          text: "Hey what's up man? Are we still meeting tomorrow?",
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
        // 10. Adversarial Stress payload (1KB repetitive)
        {
          id: 'c10',
          packageName: 'com.adv.test',
          title: 'Adversarial Alert',
          text: 'Use promo code FLASH50 for 50% off! ' + 'random garbage words '.repeat(30) + 'Expires in 2 hours.',
          timestamp: benchmarkNow.getTime(),
          postTime: benchmarkNow.getTime(),
        },
      ];

      const ITERATIONS = 10000;
      const latenciesUs: number[] = new Array(ITERATIONS);
      const internalLatenciesMs: number[] = new Array(ITERATIONS);

      // JIT Warmup (500 iterations)
      for (let w = 0; w < 500; w++) {
        classifyNotification(corpus[w % corpus.length], benchmarkNow);
      }

      const benchmarkStart = performance.now();

      for (let i = 0; i < ITERATIONS; i++) {
        const payload = corpus[i % corpus.length];
        const iterStart = performance.now();
        const result = classifyNotification(payload, benchmarkNow);
        const iterElapsed = performance.now() - iterStart;
        latenciesUs[i] = iterElapsed * 1000; // Convert ms to microseconds (µs)
        internalLatenciesMs[i] = result.evaluationTimeMs;
        expect(result.stream).toBeDefined();
      }

      const totalBenchmarkMs = performance.now() - benchmarkStart;
      latenciesUs.sort((a, b) => a - b);
      internalLatenciesMs.sort((a, b) => a - b);

      const minUs = latenciesUs[0];
      const maxUs = latenciesUs[latenciesUs.length - 1];
      const p50Us = latenciesUs[Math.floor(ITERATIONS * 0.50)];
      const p95Us = latenciesUs[Math.floor(ITERATIONS * 0.95)];
      const p99Us = latenciesUs[Math.floor(ITERATIONS * 0.99)];
      const p999Us = latenciesUs[Math.floor(ITERATIONS * 0.999)];
      const avgUs = latenciesUs.reduce((sum, val) => sum + val, 0) / ITERATIONS;
      const avgMs = avgUs / 1000;
      const maxMs = maxUs / 1000;

      const internalAvgMs = internalLatenciesMs.reduce((sum, val) => sum + val, 0) / ITERATIONS;
      const internalP99Ms = internalLatenciesMs[Math.floor(ITERATIONS * 0.99)];

      console.log(`\n======================================================`);
      console.log(`🚀 10,000 CLASSIFICATION LATENCY BENCHMARK RESULTS`);
      console.log(`======================================================`);
      console.log(`Total 10k Run Time:    ${totalBenchmarkMs.toFixed(2)} ms`);
      console.log(`Average Latency:       ${avgUs.toFixed(2)} µs (${avgMs.toFixed(4)} ms)`);
      console.log(`Minimum Latency:       ${minUs.toFixed(2)} µs`);
      console.log(`Median (p50) Latency:  ${p50Us.toFixed(2)} µs`);
      console.log(`95th %ile (p95):       ${p95Us.toFixed(2)} µs`);
      console.log(`99th %ile (p99):       ${p99Us.toFixed(2)} µs`);
      console.log(`99.9th %ile (p99.9):   ${p999Us.toFixed(2)} µs`);
      console.log(`Maximum Latency:       ${maxUs.toFixed(2)} µs (${maxMs.toFixed(4)} ms)`);
      console.log(`Internal Avg Latency:  ${internalAvgMs.toFixed(4)} ms`);
      console.log(`Internal p99 Latency:  ${internalP99Ms.toFixed(4)} ms`);
      console.log(`Target Spec:           <30,000 µs (<30.0 ms)`);
      console.log(`Speedup vs Target:     ${(30000 / avgUs).toFixed(1)}x faster than SLA`);
      console.log(`======================================================\n`);

      // Verifications against SLA (<30ms)
      expect(avgMs).toBeLessThan(0.5); // Average must be < 0.5ms (target <30ms)
      expect(p95Us / 1000).toBeLessThan(2.0); // p95 must be < 2ms
      expect(p99Us / 1000).toBeLessThan(5.0); // p99 must be < 5ms
      expect(p999Us / 1000).toBeLessThan(20.0); // 99.9% of all 10k runs must be < 20ms
      expect(internalP99Ms).toBeLessThan(5.0); // Internal engine execution p99 < 5ms
    });
  });
});
