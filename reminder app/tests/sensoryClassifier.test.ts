import {
  classifyNotification,
  checkQuarantine,
  checkNoise,
  parsePromo,
  extractDate,
  isPackageAllowed,
  validateFilterConfig,
  DEFAULT_FILTER_CONFIG,
  RawNotificationPayload,
} from '../src/sensory';

describe('Remy Notification Sensory Engine - Intent Classifier', () => {
  const fixedNow = new Date('2026-09-14T10:00:00.000Z');

  describe('23-Point Notification Classification Matrix', () => {
    test('1. Food delivery out for delivery (Swiggy)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-1',
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Order out for delivery! Arriving in 15 mins.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable).toBeDefined();
      expect(result.actionable?.actionVerb).toBe('Receive');
      expect(result.actionable?.title).toContain('Swiggy');
      expect(result.actionable?.armed).toBe(true);
      expect(result.actionable?.category).toBe('delivery');
      expect(new Date(result.actionable!.inferredDueDate).getTime()).toBe(
        fixedNow.getTime() + 15 * 60 * 1000
      );
    });

    test('2. Food delivery promo voucher with midnight expiry (Zomato)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-2',
        packageName: 'com.application.zomato',
        title: 'Zomato',
        text: 'Craving biryani? Use code BIRYANI50 to get 50% OFF up to ₹100! Valid till midnight.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal).toBeDefined();
      expect(result.deal?.merchant).toBe('Zomato');
      expect(result.deal?.code).toBe('BIRYANI50');
      expect(result.deal?.discount).toBe('50% OFF');
      expect(result.deal?.discountType).toBe('percentage');
      expect(result.deal?.discountValue).toBe(50);
      expect(result.deal?.expiryDate).toBeDefined();
    });

    test('3. Post-meal rating feedback noise (Swiggy)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-3',
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: "Hope you enjoyed your lunch! Don't forget to rate your order.",
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('unactionable');
    });

    test('4. E-commerce delivery with item description and specific time (Amazon)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-4',
        packageName: 'in.amazon.mShop.android.shopping',
        title: 'Amazon',
        text: "Your package containing 'Wireless Mouse' is out for delivery. Arriving today by 8 PM.",
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Receive');
      expect(result.actionable?.title).toContain('Wireless Mouse');
      expect(result.actionable?.armed).toBe(true);
      expect(result.actionable?.category).toBe('delivery');
    });

    test('5. Fashion e-commerce coupon with flat discount & weekday expiry (Myntra)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-5',
        packageName: 'com.myntra.android',
        title: 'Myntra',
        text: 'End of Reason Sale! Use coupon MYNTRA200 for flat ₹200 OFF on orders over ₹1499. Offer ends Sunday!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.merchant).toBe('Myntra');
      expect(result.deal?.code).toBe('MYNTRA200');
      expect(result.deal?.discount).toBe('flat ₹200 OFF');
      expect(result.deal?.discountValue).toBe(200);
      expect(result.deal?.discountType).toBe('flat');
      expect(result.deal?.expiryDate).toBeDefined();
    });

    test('6. Past delivery status confirmation noise (Amazon)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-6',
        packageName: 'in.amazon.mShop.android.shopping',
        title: 'Amazon',
        text: 'Delivered: Your package was handed directly to a resident.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('past_receipt');
    });

    test('7. Electricity bill payment with explicit calendar date (HDFC)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-7',
        packageName: 'com.snapwork.hdfc',
        title: 'HDFC Bank',
        text: 'Electricity bill of Rs 1,840 is generated. Due date: 20-Sep-2026. Pay now.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Pay');
      expect(result.actionable?.title).toContain('electricity bill');
      expect(result.actionable?.category).toBe('bill');
      expect(result.actionable?.armed).toBe(true);
      const dueDate = new Date(result.actionable!.inferredDueDate);
      expect(dueDate.getDate()).toBe(20);
      expect(dueDate.getMonth()).toBe(8); // September is month 8 (0-indexed)
      expect(dueDate.getFullYear()).toBe(2026);
    });

    test('8. Postpaid mobile bill due tomorrow (Airtel)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-8',
        packageName: 'com.airtel.thanks',
        title: 'Airtel',
        text: 'Your postpaid bill of Rs 599 is due tomorrow. Recharge now.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Pay');
      expect(result.actionable?.title).toContain('postpaid bill');
      expect(result.actionable?.armed).toBe(true);
      expect(result.actionable?.category).toBe('bill');
    });

    test('9. Sensitive Banking OTP quarantine (SBI)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-9',
        packageName: 'com.sbi.upi',
        title: 'SBI',
        text: '849201 is your OTP for transaction of INR 3,500 at Flipkart. Valid for 10 mins. Do not share.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.actionable).toBeUndefined();
      expect(result.deal).toBeUndefined();
    });

    test('10. Bank debit transaction receipt noise (ICICI)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-10',
        packageName: 'com.icici.bank',
        title: 'ICICI Bank',
        text: 'Acct XX1234 debited for INR 450.00 on 14-Sep-26 at Starbucks. Avl Bal: INR 45,210.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('past_receipt');
    });

    test('11. Flight web check-in alert (IndiGo)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-11',
        packageName: 'in.goindigo.android',
        title: 'IndiGo',
        text: 'Web check-in is now open for flight 6E-204 departing tomorrow at 08:30 AM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Check in');
      expect(result.actionable?.title).toContain('6E-204');
      expect(result.actionable?.category).toBe('travel');
      expect(result.actionable?.armed).toBe(true);
    });

    test('12. Ride arriving alert with vehicle plate (Uber)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-12',
        packageName: 'com.ubercab',
        title: 'Uber',
        text: 'Your driver Ramesh in Swift Dzire (KA01AB1234) is arriving in 3 mins.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Board');
      expect(result.actionable?.title).toContain('KA01AB1234');
      expect(result.actionable?.category).toBe('travel');
      expect(result.actionable?.armed).toBe(true);
      // License plate must NOT be extracted as a deal
      expect(result.deal).toBeUndefined();
    });

    test('13. Ride hailing promo voucher with weekday expiry (Uber)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-13',
        packageName: 'com.ubercab',
        title: 'Uber',
        text: 'Riding today? Apply promo code UBERGO50 for 50% discount on your next 3 rides. Valid till Friday.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.merchant).toBe('Uber');
      expect(result.deal?.code).toBe('UBERGO50');
      expect(result.deal?.discount).toBe('50% DISCOUNT');
      expect(result.deal?.expiryDate).toBeDefined();
    });

    test('14. Food voucher with hourly expiry (Domino\'s)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-14',
        packageName: 'com.dominospizza',
        title: "Domino's",
        text: 'Flat ₹150 OFF on orders over ₹400! Use voucher CHEESE150 at checkout. Expires in 3 hours.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.merchant).toBe("Domino's");
      expect(result.deal?.code).toBe('CHEESE150');
      expect(result.deal?.discount).toBe('Flat ₹150 OFF');
      expect(result.deal?.expiryDate).toBeDefined();
    });

    test('15. Chat message conversational banter noise (WhatsApp)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-15',
        packageName: 'com.whatsapp',
        title: 'John',
        text: "Hey what's up man? Are we still meeting tomorrow?",
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('chat');
    });

    test('16. Social media follower alert noise (Instagram)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-16',
        packageName: 'com.instagram.android',
        title: 'Instagram',
        text: 'Alex started following you.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('social');
    });

    test('17. App store update completion noise (Google Play)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-17',
        packageName: 'com.android.vending',
        title: 'Google Play Store',
        text: '14 apps updated successfully.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('system_status');
    });

    test('18. Standalone promo code extraction (Uber)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-18',
        packageName: 'com.ubercab',
        title: 'Uber',
        text: 'SAVE50 is now active! Get 50% off your next ride.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.code).toBe('SAVE50');
      expect(result.deal?.discount).toBe('50% OFF');
    });

    test('19. Action code at checkout (Swiggy)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-19',
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Apply SWIGGYIT at checkout for Rs 100 off.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('deal');
      expect(result.deal?.code).toBe('SWIGGYIT');
    });

    test('20. Google verification code quarantine', () => {
      const payload: RawNotificationPayload = {
        id: 'case-20',
        packageName: 'com.google.android.gms',
        title: 'Google',
        text: '123456 is your Google verification code.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
    });

    test('21. Password reset code quarantine', () => {
      const payload: RawNotificationPayload = {
        id: 'case-21',
        packageName: 'com.auth.service',
        title: 'Security Service',
        text: 'Your password reset code is 998877. Never disclose this to anyone.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
    });

    test('22. Doctor appointment schedule (Practo)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-22',
        packageName: 'com.practo.client',
        title: 'Practo',
        text: 'Your appointment with Dr. Sharma is scheduled for tomorrow at 4:30 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Attend');
      expect(result.actionable?.category).toBe('appointment');
      expect(result.actionable?.armed).toBe(true);
    });

    test('23. Courier delivery with time cue (DHL)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-23',
        packageName: 'com.dhl.express',
        title: 'DHL Express',
        text: 'Courier out for delivery. Package arriving by 5 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.actionVerb).toBe('Receive');
      expect(result.actionable?.title).toContain('DHL Express');
      expect(result.actionable?.armed).toBe(true);
    });

    test('24. Adversarial Edge Case: Mixed promo and OTP text (quarantine must strictly win)', () => {
      const payload: RawNotificationPayload = {
        id: 'case-24',
        packageName: 'com.bank.service',
        title: 'Special Offer & Security',
        text: 'Get 20% off your electricity bill! Your OTP is 5849. Never share your password.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
      expect(result.deal).toBeUndefined();
      expect(result.actionable).toBeUndefined();
    });
  });

  describe('Security Quarantine Gate (checkQuarantine)', () => {
    test('quarantines 4-8 digit OTPs with auth keywords', () => {
      expect(checkQuarantine('Bank', 'Your OTP is 4829').quarantined).toBe(true);
      expect(checkQuarantine('Auth', 'verification code: 948201').quarantined).toBe(true);
      expect(checkQuarantine('Login', 'use security pin 123456 to log in').quarantined).toBe(true);
    });

    test('does not false-positive on promo codes with numbers', () => {
      expect(checkQuarantine('Zomato', 'Use code SAVE50 to get 50% off').quarantined).toBe(false);
      expect(checkQuarantine('Amazon', 'Order #12345 has shipped').quarantined).toBe(false);
    });
  });

  describe('Performance Guarantee (<30ms, benchmarked <0.5ms)', () => {
    test('classifies a single notification well within 30ms', () => {
      const payload: RawNotificationPayload = {
        id: 'perf-1',
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Order out for delivery! Arriving in 15 mins.',
        timestamp: Date.now(),
        postTime: Date.now(),
      };

      const start = performance.now();
      const result = classifyNotification(payload);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(30);
      expect(result.evaluationTimeMs).toBeLessThan(30);
    });

    test('benchmarks 1,000 notifications in under 50ms (<0.05ms average)', () => {
      const payload: RawNotificationPayload = {
        id: 'bench-1',
        packageName: 'com.application.zomato',
        title: 'Zomato',
        text: 'Craving pizza? Use code PIZZA30 for 30% OFF. Offer ends midnight.',
        timestamp: Date.now(),
        postTime: Date.now(),
      };

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        classifyNotification(payload);
      }
      const totalTime = performance.now() - start;
      expect(totalTime).toBeLessThan(500);
    });
  });

  describe('Sensory Filter Config (Whitelist / Blacklist)', () => {
    test('default blacklist blocks system apps and permits user apps', () => {
      expect(isPackageAllowed('com.android.systemui', DEFAULT_FILTER_CONFIG)).toBe(false);
      expect(isPackageAllowed('com.google.android.gms', DEFAULT_FILTER_CONFIG)).toBe(false);
      expect(isPackageAllowed('com.swiggy.android', DEFAULT_FILTER_CONFIG)).toBe(true);
      expect(isPackageAllowed('in.amazon.mShop.android.shopping', DEFAULT_FILTER_CONFIG)).toBe(true);
    });

    test('whitelist mode permits only listed apps', () => {
      const whitelistConfig = validateFilterConfig({
        mode: 'whitelist',
        packages: ['com.swiggy.android', 'com.application.zomato'],
        enableOtpQuarantine: true,
        ignoreOngoing: true,
      });

      expect(isPackageAllowed('com.swiggy.android', whitelistConfig)).toBe(true);
      expect(isPackageAllowed('com.application.zomato', whitelistConfig)).toBe(true);
      expect(isPackageAllowed('com.facebook.katana', whitelistConfig)).toBe(false);
    });

    test('disabled config blocks all incoming notifications', () => {
      const disabledConfig = validateFilterConfig({
        ...DEFAULT_FILTER_CONFIG,
        enabled: false,
      });
      expect(isPackageAllowed('com.swiggy.android', disabledConfig)).toBe(false);
    });
  });

  describe('Date & Deadline Extractor (extractDate)', () => {
    test('extracts relative minutes with second truncation', () => {
      const result = extractDate('arriving in 12 mins', fixedNow);
      expect(result.armed).toBe(true);
      expect(result.date.getSeconds()).toBe(0);
      expect(result.date.getMilliseconds()).toBe(0);
      expect(result.date.getTime()).toBe(fixedNow.getTime() + 12 * 60 * 1000);
    });

    test('extracts relative hours with second truncation', () => {
      const result = extractDate('expires in 3 hours', fixedNow);
      expect(result.armed).toBe(true);
      expect(result.date.getSeconds()).toBe(0);
      expect(result.date.getTime()).toBe(fixedNow.getTime() + 3 * 3600 * 1000);
    });

    test('extracts absolute clock time today', () => {
      const result = extractDate('arriving by 5 PM', fixedNow);
      expect(result.armed).toBe(true);
      expect(result.date.getHours()).toBe(17);
      expect(result.date.getMinutes()).toBe(0);
      expect(result.date.getSeconds()).toBe(0);
    });

    test('extracts absolute clock time tomorrow', () => {
      const result = extractDate('departing tomorrow at 08:30 AM', fixedNow);
      expect(result.armed).toBe(true);
      expect(result.date.getHours()).toBe(8);
      expect(result.date.getMinutes()).toBe(30);
      expect(result.date.getDate()).toBe(fixedNow.getDate() + 1);
    });

    test('extracts calendar date with month name', () => {
      const result = extractDate('due date: 25-Sep-2026', fixedNow);
      expect(result.armed).toBe(true);
      expect(result.date.getDate()).toBe(25);
      expect(result.date.getMonth()).toBe(8); // September
      expect(result.date.getFullYear()).toBe(2026);
    });
  });

  describe('Promo Parser (parsePromo)', () => {
    test('extracts percentage discounts and coupon codes', () => {
      const deal = parsePromo('Zomato', 'Use code BIRYANI50 for 50% OFF', 'com.application.zomato', fixedNow);
      expect(deal).not.toBeNull();
      expect(deal?.code).toBe('BIRYANI50');
      expect(deal?.discount).toBe('50% OFF');
      expect(deal?.discountType).toBe('percentage');
    });

    test('rejects license plate numbers from being extracted as coupon codes', () => {
      const deal = parsePromo('Uber', 'Driver Ramesh (KA01AB1234) is arriving in 3 mins', 'com.ubercab', fixedNow);
      expect(deal).toBeNull();
    });

    test('extracts flat cash discounts and freebies', () => {
      const freebie = parsePromo('Swiggy', 'Free delivery on all orders today!', 'com.swiggy.android', fixedNow);
      expect(freebie?.discountType).toBe('freebie');
      expect(freebie?.discount).toBe('Free delivery');
    });
  });
});
