import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;

import { HomeScreen } from '../src/screens/HomeScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import {
  classifyNotification,
  checkScam,
  isBankTransaction,
  checkQuarantine,
  isMessagingPackage,
  MESSAGING_PACKAGES,
  sensoryBridge,
  RawNotificationPayload,
} from '../src/sensory';

describe('SMS Scam & Clutter Identification with Guardrails & Mark-As-Read Suite', () => {
  const fixedNow = new Date('2026-09-22T10:00:00.000Z');

  beforeEach(async () => {
    await sensoryBridge.clearPendingNotifications();
    if (typeof sensoryBridge.clearMockTray === 'function') {
      sensoryBridge.clearMockTray();
    }
  });

  // =========================================================================
  // 1. SCAM SMS IDENTIFICATION BY CATEGORY
  // =========================================================================
  describe('Part 1: Fraudulent & Scammy SMS Identification', () => {
    test('identifies lottery / jackpot winnings fraud SMS (Google Messages)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-lottery-1',
        key: '0|com.google.android.apps.messaging|101|null|20001',
        packageName: 'com.google.android.apps.messaging',
        title: 'KBC-WINNER',
        text: 'Congratulations! You have won Rs 25,00,000 in KBC Lucky Draw contest. Call manager at 9876543210 to claim your cash prize money immediately.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('lottery_fraud');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('lottery_fraud');
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    test('identifies fake PAN / Aadhaar / KYC suspension warning SMS (Samsung Messages)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-kyc-1',
        key: '0|com.samsung.android.messaging|102|null|20002',
        packageName: 'com.samsung.android.messaging',
        title: 'SBI-ALERT',
        text: 'Dear customer, your SBI bank account has been suspended due to pending KYC. Click http://sbi-kyc-update.net/apk to update PAN card immediately.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('fake_kyc_suspension');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('fake_kyc_suspension');
    });

    test('identifies fake electricity / utility disconnection threat SMS (OnePlus MMS)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-elec-1',
        key: '0|com.oneplus.mms|103|null|20003',
        packageName: 'com.oneplus.mms',
        title: 'POWER-DEPT',
        text: 'Dear customer, your electricity power will be disconnected tonight at 9:30 PM because your previous month bill was not updated. Please contact electricity officer at 9876543210 immediately.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('disconnection_threat');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('disconnection_threat');
    });

    test('identifies predatory pre-approved loan & instant credit card traps (Truecaller)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-loan-1',
        key: '0|com.truecaller|104|null|20004',
        packageName: 'com.truecaller',
        title: 'LOAN-OFFER',
        text: 'Congratulations! Pre-approved personal loan of Rs 5,00,000 approved and disbursed. No cibil score, no documents required, 0% interest. Click bit.ly/claim-loan to claim now.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('unauthorized_loan_trap');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('unauthorized_loan_trap');
    });

    test('identifies suspicious urgent APK download or malicious shortened links (Xiaomi MMS)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-apk-1',
        key: '0|com.xiaomi.mms|105|null|20005',
        packageName: 'com.xiaomi.mms',
        title: 'UPDATE-NOTICE',
        text: 'Urgent security update required for WhatsApp Pink APK. Download and install apk now: bit.ly/whatsapp-pink.apk',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('suspicious_apk_or_link');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('suspicious_apk_or_link');
    });

    test('identifies crypto / part-time job investment doubling schemes (Motorola Messaging)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-crypto-1',
        key: '0|com.motorola.messaging|106|null|20006',
        packageName: 'com.motorola.messaging',
        title: 'DAILY-EARN',
        text: 'Earn ₹3000 - ₹8000 daily working from home by liking YouTube videos! Guaranteed daily payout. Join telegram channel now.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('crypto_investment_scheme');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('crypto_investment_scheme');
    });

    test('identifies aggressive gambling / casino betting spam (Oppo / ColorOS MMS)', () => {
      const payload: RawNotificationPayload = {
        id: 'scam-betting-1',
        key: '0|com.coloros.mms|107|null|20007',
        packageName: 'com.coloros.mms',
        title: 'RUMMY-PROMO',
        text: 'Play online rummy and get deposit bonus of ₹1000 free cash! Register and claim 100% deposit bonus today.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('gambling_spam');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('gambling_spam');
    });
  });

  // =========================================================================
  // 2. CRUCIAL GUARDRAILS (ZERO MISCLASSIFICATION)
  // =========================================================================
  describe('Part 2: Strict Guardrails (Never Misclassify Genuine Traffic)', () => {
    test('preserves genuine bank transactional debits / credits (HDFC debit)', () => {
      const payload: RawNotificationPayload = {
        id: 'bank-debit-1',
        key: '0|com.google.android.apps.messaging|201|null|21001',
        packageName: 'com.google.android.apps.messaging',
        title: 'AD-HDFCBK',
        text: 'Dear Customer, INR 5,000.00 debited from A/c XX1234 on 22-Sep-26 by UPI:ref 99887766. Bal: INR 25,430.00 - HDFC Bank',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      expect(isBankTransaction(payload.title, payload.text)).toBe(true);
      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).not.toBe('scam');
      expect(result.stream).toBe('noise');
      expect(result.noise?.reason).toBe('past_receipt');
    });

    test('preserves genuine bank transactional credit (SBI credit)', () => {
      const payload: RawNotificationPayload = {
        id: 'bank-credit-1',
        key: '0|com.google.android.apps.messaging|202|null|21002',
        packageName: 'com.google.android.apps.messaging',
        title: 'VK-SBIINB',
        text: 'Your a/c no. XX9876 is credited by Rs 12,000.00 on 22-Sep-26 by transfer from XYZ. Avail Bal Rs 45,000 - SBI',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      expect(isBankTransaction(payload.title, payload.text)).toBe(true);
      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).not.toBe('scam');
    });

    test('preserves credit card spending alert with available limit', () => {
      const payload: RawNotificationPayload = {
        id: 'card-spend-1',
        key: '0|com.google.android.apps.messaging|203|null|21003',
        packageName: 'com.google.android.apps.messaging',
        title: 'AX-ICICIB',
        text: 'Transaction of Rs. 450.00 done on Credit Card ending in 4321 at RELIANCE RETAIL on 22-SEP-26. Avail Bal: Rs. 85,000.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      expect(isBankTransaction(payload.title, payload.text)).toBe(true);
      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).not.toBe('scam');
    });

    test('preserves two-factor authentication OTPs (never marked as scam, quarantined for safety)', () => {
      const payload: RawNotificationPayload = {
        id: 'otp-2fa-1',
        key: '0|com.google.android.apps.messaging|204|null|21004',
        packageName: 'com.google.android.apps.messaging',
        title: 'VM-AMAZON',
        text: '123456 is your OTP for purchase of Rs 500 at Amazon. Valid for 10 mins. Do not share this OTP with anyone.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      expect(checkQuarantine(payload.title, payload.text).quarantined).toBe(true);
      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('quarantined');
      expect(result.quarantineReason).toBe('SENSITIVE_AUTH_CODE');
    });

    test('preserves genuine delivery tracking alerts as actionable', () => {
      const payload: RawNotificationPayload = {
        id: 'delivery-sms-1',
        key: '0|com.google.android.apps.messaging|205|null|21005',
        packageName: 'com.google.android.apps.messaging',
        title: 'BLUEDART',
        text: 'Your order has shipped and is out for delivery today. Arriving by 7 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('delivery');
      expect(result.actionable?.actionVerb).toBe('Receive');
    });

    test('preserves legitimate electricity bill reminders as actionable (contrasted with fake disconnection scams)', () => {
      const payload: RawNotificationPayload = {
        id: 'bill-elec-legit',
        key: '0|com.google.android.apps.messaging|206|null|21006',
        packageName: 'com.google.android.apps.messaging',
        title: 'BESCOM-BILL',
        text: 'Electricity bill of Rs 1,840 is generated. Due date: 20-Sep-2026. Pay now.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('bill');
      expect(result.actionable?.actionVerb).toBe('Pay');
    });

    test('preserves legitimate car loan EMI payment reminders as actionable', () => {
      const payload: RawNotificationPayload = {
        id: 'bill-emi-legit',
        key: '0|com.google.android.apps.messaging|207|null|21007',
        packageName: 'com.google.android.apps.messaging',
        title: 'HDFC-LOAN',
        text: 'Your car loan EMI due date is tomorrow. Amount due: Rs 14,250.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('bill');
    });

    test('preserves normal personal chat messages from contacts', () => {
      const payload: RawNotificationPayload = {
        id: 'personal-chat-1',
        key: '0|com.google.android.apps.messaging|208|null|21008',
        packageName: 'com.google.android.apps.messaging',
        title: 'Priya',
        text: 'Hey! Are you free for lunch this afternoon? Let me know.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(false);

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).not.toBe('scam');
    });

    test('preserves personal contact messages containing "you won" without prize fraud context', () => {
      const testCases = [
        { title: 'John', text: 'Hey Alex, awesome game today! You won!' },
        { title: 'Sarah', text: 'Congratulations, you won the match!' },
        { title: '+919876543210', text: 'Did you know you won the election?' },
      ];

      for (const tc of testCases) {
        const scamCheck = checkScam(tc.title, tc.text, 'com.google.android.apps.messaging');
        expect(scamCheck.isScam).toBe(false);
      }
    });

    test('catches phishing APK download disguised as delivery rescheduling', () => {
      const payload: RawNotificationPayload = {
        id: 'fake-delivery-apk',
        key: '0|com.google.android.apps.messaging|209|null|21009',
        packageName: 'com.google.android.apps.messaging',
        title: 'INDIA-POST',
        text: 'Delivery attempt failed. Package arriving today requires address update. Download http://ind-post.net/update.apk to reschedule.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('suspicious_apk_or_link');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('suspicious_apk_or_link');
    });

    test('catches bank phishing alert even when mentioning a/c balance or numbers', () => {
      const payload: RawNotificationPayload = {
        id: 'fake-bank-balance-phish',
        key: '0|com.google.android.apps.messaging|210|null|21010',
        packageName: 'com.google.android.apps.messaging',
        title: 'SBI-URGENT',
        text: 'Dear customer, your SBI a/c XX4321 is blocked. Avail Bal: Rs 50,000. Update PAN card immediately to unfreeze at bit.ly/sbi-pan-kyc',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('fake_kyc_suspension');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('fake_kyc_suspension');
    });

    test('identifies aggressive telemarketing and real estate plots spam', () => {
      const payload: RawNotificationPayload = {
        id: 'spam-telemarketing-1',
        key: '0|com.google.android.apps.messaging|211|null|21011',
        packageName: 'com.google.android.apps.messaging',
        title: 'REALTY-DEALS',
        text: 'Exclusive villa plots near Airport starting at Rs 45 Lakhs. Free site visit, call now 9876543210.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const scamCheck = checkScam(payload.title, payload.text, payload.packageName);
      expect(scamCheck.isScam).toBe(true);
      expect(scamCheck.reason).toBe('aggressive_telemarketing');

      const result = classifyNotification(payload, fixedNow);
      expect(result.stream).toBe('scam');
      expect(result.scam?.reason).toBe('aggressive_telemarketing');
    });
  });

  // =========================================================================
  // 3. SMS PACKAGES & MESSAGING APP COVERAGE
  // =========================================================================
  describe('Part 3: Comprehensive SMS Packages Detection Across Android OEMs', () => {
    test('isMessagingPackage detects Google, Samsung, Truecaller, and major OEM packages', () => {
      const expectedPackages = [
        'com.google.android.apps.messaging',
        'com.samsung.android.messaging',
        'com.truecaller',
        'com.oneplus.mms',
        'com.xiaomi.mms',
        'com.miui.mms',
        'com.coloros.mms',
        'com.oppo.mms',
        'com.vivo.mms',
        'com.transsion.mms',
        'com.motorola.messaging',
        'com.sonyericsson.conversations',
        'com.sonymobile.conversations',
        'com.android.mms',
        'com.huawei.message',
      ];

      for (const pkg of expectedPackages) {
        expect(isMessagingPackage(pkg)).toBe(true);
        expect(MESSAGING_PACKAGES).toContain(pkg);
      }

      // Non-messaging apps
      expect(isMessagingPackage('com.swiggy.android')).toBe(false);
      expect(isMessagingPackage('in.amazon.mShop.android.shopping')).toBe(false);
      expect(isMessagingPackage('com.spotify.music')).toBe(false);
    });
  });

  // =========================================================================
  // 4. ACTION EXECUTION: MARK AS READ & CLEAR NOTIFICATION
  // =========================================================================
  describe('Part 4: Action Execution on Live Scam SMS', () => {
    test('marks as read and dismisses scam SMS when routed through HomeScreen', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const scamSmsKey = '0|com.google.android.apps.messaging|999|null|77777';
      const liveScamSms: RawNotificationPayload = {
        id: 'live-scam-sms-1',
        key: scamSmsKey,
        packageName: 'com.google.android.apps.messaging',
        title: 'LOTTERY-DEPT',
        text: 'Congratulations! You have won Rs 50,00,000 jackpot prize in KBC lucky draw. Call 9876543210 to claim immediately.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(liveScamSms);
      });

      // Verify mark-as-read action was invoked for SMS
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(scamSmsKey);
      }

      // Verify notification was dismissed from tray
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(scamSmsKey);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('marks as read and dismisses fake KYC SMS from Samsung Messages', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const scamKycKey = '0|com.samsung.android.messaging|888|null|66666';
      const liveKycSms: RawNotificationPayload = {
        id: 'live-kyc-sms-1',
        key: scamKycKey,
        packageName: 'com.samsung.android.messaging',
        title: 'HDFC-NOTICE',
        text: 'Dear customer, your bank account has been blocked due to expired PAN card. Complete e-KYC verification at bit.ly/hdfc-kyc-update immediately.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(liveKycSms);
      });

      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(scamKycKey);
      }
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(scamKycKey);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('does NOT mark as read or dismiss scam SMS when autoClearScam is disabled', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} autoClearScam={false} />
          </ThemeProvider>
        );
      });

      const scamKey = '0|com.google.android.apps.messaging|555|null|11111';
      const liveScam: RawNotificationPayload = {
        id: 'live-scam-disabled-test',
        key: scamKey,
        packageName: 'com.google.android.apps.messaging',
        title: 'JACKPOT',
        text: 'Congratulations! You have won Rs 50,00,000 lottery bumper prize. Call 9876543210.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(liveScam);
      });

      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).not.toContain(scamKey);
      }
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).not.toContain(scamKey);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('sensoryBridge supports setAutoClearScam and getAutoClearScam', async () => {
      await sensoryBridge.setAutoClearScam(false);
      expect(await sensoryBridge.getAutoClearScam()).toBe(false);

      let cfg = await sensoryBridge.getFilterConfig();
      expect(cfg.autoClearScam).toBe(false);

      await sensoryBridge.setAutoClearScam(true);
      expect(await sensoryBridge.getAutoClearScam()).toBe(true);

      cfg = await sensoryBridge.getFilterConfig();
      expect(cfg.autoClearScam).toBe(true);
    });
  });
});
