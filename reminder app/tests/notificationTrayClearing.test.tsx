import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { HomeScreen } from '../src/screens/HomeScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { sensoryBridge, RawNotificationPayload } from '../src/sensory/sensoryBridge';
import { intentClassifier } from '../src/sensory/intentClassifier';
import { sensoryStorageService } from '../src/sensory/sensoryStorageService';
import { dealsStorageService } from '../src/sensory/dealsStorageService';
import { isMessagingPackage } from '../src/sensory/sensoryFilterConfig';

describe('Notification Tray Clearing, Snoozing & Important Ingress Suite', () => {
  const fixedNow = new Date('2026-09-19T10:00:00.000Z');

  beforeEach(async () => {
    await sensoryStorageService.clear();
    await dealsStorageService.clear();
    await sensoryBridge.clearPendingNotifications();
    if (typeof sensoryBridge.clearMockTray === 'function') {
      sensoryBridge.clearMockTray();
    }
    await sensoryBridge.setAutoClearPromos(true);
    await sensoryBridge.setAutoSnoozeNoise(false);
  });

  describe('Part 1: Important Notification Capture (Delivery, Bills, Travel, Appointments, Action Items)', () => {
    test('captures delivery tracking (shipped/in-transit) as actionable with inferred due date', async () => {
      const payload: RawNotificationPayload = {
        id: 'delivery-shipped-1',
        key: '0|com.amazon.mShop.android.shopping|101|null|10001',
        packageName: 'com.amazon.mShop.android.shopping',
        title: 'Amazon',
        text: 'Your order has shipped and is in transit. Arriving today by 6 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = intentClassifier.classify(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable).toBeDefined();
      expect(result.actionable?.category).toBe('delivery');
      expect(result.actionable?.actionVerb).toBe('Receive');
      expect(result.actionable?.armed).toBe(true);

      const added = await sensoryStorageService.addFromExtraction(result.actionable!, payload);
      expect(added.key).toBe(payload.key);
      expect(sensoryStorageService.getPendingSuggestions().length).toBe(1);
    });

    test('captures diverse bill dues (broadband, recharge, EMI) into sensory review queue', async () => {
      const payloads: RawNotificationPayload[] = [
        {
          id: 'bill-broadband',
          packageName: 'com.airtel.thanks',
          title: 'Airtel',
          text: 'Broadband bill of Rs 999 is generated. Due date: 25-Sep-2026.',
          timestamp: fixedNow.getTime(),
          postTime: fixedNow.getTime(),
        },
        {
          id: 'bill-emi',
          packageName: 'com.snapwork.hdfc',
          title: 'HDFC Bank',
          text: 'Your car loan EMI due date is tomorrow. Amount due: Rs 14,250.',
          timestamp: fixedNow.getTime(),
          postTime: fixedNow.getTime(),
        },
        {
          id: 'bill-recharge',
          packageName: 'com.jio.myjio',
          title: 'Jio',
          text: 'Recharge due: Your plan expires in 3 hours. Pay before expiration.',
          timestamp: fixedNow.getTime(),
          postTime: fixedNow.getTime(),
        },
      ];

      for (const p of payloads) {
        const result = intentClassifier.classify(p, fixedNow);
        expect(result.stream).toBe('actionable');
        expect(result.actionable?.category).toBe('bill');
        expect(result.actionable?.actionVerb).toBe('Pay');
        await sensoryStorageService.addFromExtraction(result.actionable!, p);
      }

      const pending = sensoryStorageService.getPendingSuggestions();
      expect(pending.length).toBe(3);
    });

    test('captures train departure and transit alerts with PNR details', async () => {
      const payload: RawNotificationPayload = {
        id: 'train-alert-1',
        packageName: 'com.irctc.train',
        title: 'IRCTC',
        text: 'Train 12951 Mumbai Rajdhani departs tomorrow at 08:30 AM from Platform 3. PNR: 2451234567 confirmed.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = intentClassifier.classify(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('travel');
      expect(result.actionable?.actionVerb).toBe('Board');
      expect(result.actionable?.armed).toBe(true);

      const added = await sensoryStorageService.addFromExtraction(result.actionable!, payload);
      expect(added.title).toContain('12951');
    });

    test('captures meetings, interviews and calendar appointments with dates', async () => {
      const payload: RawNotificationPayload = {
        id: 'interview-alert-1',
        packageName: 'com.google.android.calendar',
        title: 'Google Calendar',
        text: 'Meeting reminder: Design review interview scheduled for tomorrow at 4:30 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = intentClassifier.classify(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('appointment');
      expect(result.actionable?.armed).toBe(true);

      const added = await sensoryStorageService.addFromExtraction(result.actionable!, payload);
      expect(added.category).toBe('appointment');
    });

    test('captures action items & imperative tasks as actionable prospective memory items', async () => {
      const payload: RawNotificationPayload = {
        id: 'action-item-1',
        packageName: 'com.slack',
        title: 'Action required',
        text: 'Please submit quarterly report by 5 PM today.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const result = intentClassifier.classify(payload, fixedNow);
      expect(result.stream).toBe('actionable');
      expect(result.actionable?.category).toBe('general');
      expect(result.actionable?.armed).toBe(true);

      const added = await sensoryStorageService.addFromExtraction(result.actionable!, payload);
      expect(added.title).toBeDefined();
    });

    test('captures package delivered and ready for pickup alerts into sensory inbox', async () => {
      const deliveredPayload: RawNotificationPayload = {
        id: 'deliv-1',
        packageName: 'com.amazon.mShop.android.shopping',
        title: 'Amazon',
        text: 'Your package has been delivered to your front door. Please collect it.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };
      const pickupPayload: RawNotificationPayload = {
        id: 'deliv-pickup',
        packageName: 'com.fedex.mobile',
        title: 'FedEx',
        text: 'Parcel ready for pickup at local counter.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      for (const p of [deliveredPayload, pickupPayload]) {
        const res = intentClassifier.classify(p, fixedNow);
        expect(res.stream).toBe('actionable');
        expect(res.actionable?.category).toBe('delivery');
        expect(res.actionable?.armed).toBe(true);
        const stored = await sensoryStorageService.addFromExtraction(res.actionable!, p);
        expect(stored.category).toBe('delivery');
      }
    });

    test('captures rent dues, fee dues, invoice dues and pending payments', async () => {
      const rentPayload: RawNotificationPayload = {
        id: 'bill-rent',
        packageName: 'com.nobroker.app',
        title: 'NoBroker',
        text: 'House rent due on 25-Sep-2026. Minimum amount due: ₹22,000.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };
      const invoicePayload: RawNotificationPayload = {
        id: 'bill-invoice',
        packageName: 'com.zoho.invoice',
        title: 'Zoho',
        text: 'Invoice due: Pending payment of $450 before tomorrow at 5 PM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      for (const p of [rentPayload, invoicePayload]) {
        const res = intentClassifier.classify(p, fixedNow);
        expect(res.stream).toBe('actionable');
        expect(res.actionable?.category).toBe('bill');
        expect(res.actionable?.actionVerb).toBe('Pay');
        expect(res.actionable?.armed).toBe(true);
      }
    });

    test('captures flight delays, gate changes and PNR ticket alerts', async () => {
      const flightDelay: RawNotificationPayload = {
        id: 'flight-delay-1',
        packageName: 'in.goindigo.android',
        title: 'IndiGo',
        text: 'Flight 6E-204 delayed by 40 mins. Boarding begins at 18:30.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };
      const pnrAlert: RawNotificationPayload = {
        id: 'pnr-ticket-1',
        packageName: 'com.irctc.train',
        title: 'IRCTC',
        text: 'PNR 4234567890 confirmed for Train 12951. Departs tomorrow at 08:30 AM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      for (const p of [flightDelay, pnrAlert]) {
        const res = intentClassifier.classify(p, fixedNow);
        expect(res.stream).toBe('actionable');
        expect(res.actionable?.category).toBe('travel');
      }
    });

    test('captures appointment reminders and doctor visits', async () => {
      const clinicPayload: RawNotificationPayload = {
        id: 'clinic-1',
        packageName: 'com.practo.android',
        title: 'Practo',
        text: 'Appointment reminder: Doctor visit scheduled for tomorrow at 10:00 AM.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      const res = intentClassifier.classify(clinicPayload, fixedNow);
      expect(res.stream).toBe('actionable');
      expect(res.actionable?.category).toBe('appointment');
      expect(res.actionable?.armed).toBe(true);
    });
  });

  describe('Part 2: Active Promotional Notification Tray Clearing & Snoozing Flow', () => {
    test('actively dismisses promotional notification from tray once stored into Deals Radar', async () => {
      const promoKey = '0|com.swiggy.android|505|null|99999';
      const simPromo: RawNotificationPayload = {
        id: 'swiggy-promo-1',
        key: promoKey,
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Super Sunday! Use code SWIGGY50 for 50% OFF up to ₹100. Valid till midnight.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      // Simulate live incoming notification
      await act(async () => {
        await sensoryBridge.simulateNotification(simPromo);
      });

      // Verify deal was stored into Deals Radar
      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.code === 'SWIGGY50')).toBe(true);

      // Verify active tray dismissal was called with the notification key
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(promoKey);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('does NOT dismiss promo from status bar tray when autoClearPromos is toggled off', async () => {
      const promoKey = '0|com.zomato.android|707|null|88888';
      const simPromo: RawNotificationPayload = {
        id: 'zomato-promo-2',
        key: promoKey,
        packageName: 'com.application.zomato',
        title: 'Zomato',
        text: 'Craving dessert? Use code SWEET20 for 20% OFF!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              currentTime={fixedNow}
              autoClearPromos={false}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        await sensoryBridge.simulateNotification(simPromo);
      });

      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.code === 'SWEET20')).toBe(true);

      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).not.toContain(promoKey);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('delegates noise snoozing to Native layer (no longer snoozes via JS)', async () => {
      const noiseKey = '0|com.social.app|808|null|77777';
      const simNoise: RawNotificationPayload = {
        id: 'noise-alert-1',
        key: noiseKey,
        packageName: 'com.instagram.android',
        title: 'Instagram',
        text: 'Alex liked your photo.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              currentTime={fixedNow}
              autoSnoozeNoise={true}
            />
          </ThemeProvider>
        );
      });

      await act(async () => {
        await sensoryBridge.simulateNotification(simNoise);
      });

      if (sensoryBridge.getMockSnoozedKeys) {
        const snoozed = sensoryBridge.getMockSnoozedKeys();
        expect(snoozed.some((s) => s.key === noiseKey)).toBe(false);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('drains pending queue and auto-clears buffered promotional alerts', async () => {
      const drainedKey = '0|com.myntra.android|909|null|66666';
      await sensoryBridge.simulateNotification({
        id: 'buffered-promo-1',
        key: drainedKey,
        packageName: 'com.myntra.android',
        title: 'Myntra',
        text: 'Flat 40% OFF with coupon FASHION40!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      // Verify dealsStorageService received the deal automatically via HomeScreen mount drain
      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.code === 'FASHION40')).toBe(true);

      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(drainedKey);
      }

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('Part 3: UI Banner and Controls in HomeScreen', () => {
    test('renders promo radar status banner and interactive toggle', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'promo-radar-status-banner' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'toggle-auto-clear-promos' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'open-deals-radar-banner-btn' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    test('toggles auto-clear promo preference upon pressing toggle button', async () => {
      const onToggleMock = jest.fn();
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              currentTime={fixedNow}
              autoClearPromos={true}
              onToggleAutoClearPromos={onToggleMock}
            />
          </ThemeProvider>
        );
      });

      const toggleBtn = renderer.root.findByProps({ testID: 'toggle-auto-clear-promos' });
      act(() => {
        toggleBtn.props.onPress();
      });

      expect(onToggleMock).toHaveBeenCalledWith(false);

      act(() => {
        renderer.unmount();
      });
    });

    test('clicking open deals radar button in banner triggers navigation', async () => {
      const onOpenDealsRadarMock = jest.fn();
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              currentTime={fixedNow}
              onOpenDealsRadar={onOpenDealsRadarMock}
            />
          </ThemeProvider>
        );
      });

      const bannerRadarBtn = renderer.root.findByProps({ testID: 'open-deals-radar-banner-btn' });
      act(() => {
        bannerRadarBtn.props.onPress();
      });

      expect(onOpenDealsRadarMock).toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });
    });

    test('renders toggle-auto-snooze-noise and invokes toggle callback upon press', async () => {
      const onToggleSnoozeMock = jest.fn();
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              currentTime={fixedNow}
              autoSnoozeNoise={false}
              onToggleAutoSnoozeNoise={onToggleSnoozeMock}
            />
          </ThemeProvider>
        );
      });

      const toggleNoiseBtn = renderer.root.findByProps({ testID: 'toggle-auto-snooze-noise' });
      expect(toggleNoiseBtn).toBeDefined();

      act(() => {
        toggleNoiseBtn.props.onPress();
      });

      expect(onToggleSnoozeMock).toHaveBeenCalledWith(true);

      act(() => {
        renderer.unmount();
      });
    });

    test('sensoryBridge getFilterConfig stays in sync with setAutoClearPromos and updateFilterConfig', async () => {
      await sensoryBridge.setAutoClearPromos(false);
      await sensoryBridge.setAutoSnoozeNoise(true);

      const config = await sensoryBridge.getFilterConfig();
      expect(config.autoClearPromos).toBe(false);
      expect(config.autoSnoozeNoise).toBe(true);

      await sensoryBridge.updateFilterConfig({
        ...config,
        autoClearPromos: true,
        autoSnoozeNoise: false,
      });

      expect(await sensoryBridge.getAutoClearPromos()).toBe(true);
      expect(await sensoryBridge.getAutoSnoozeNoise()).toBe(false);
    });
  });

  describe('Part 4: WhatsApp & SMS Promotional Mark-As-Read Action Injection & Notification Access', () => {
    test('routes promotional WhatsApp notification and invokes markAsRead', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const whatsappPromo: RawNotificationPayload = {
        id: 'whatsapp-promo-1',
        key: '0|com.whatsapp|201|null|10002',
        packageName: 'com.whatsapp',
        title: 'Domino’s Pizza',
        text: 'Special Offer: Flat 50% OFF up to Rs 150 on your order! Use code CRUST50. Valid till midnight.',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(whatsappPromo);
      });

      // Verify deal is extracted into Deals Radar
      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.code === 'CRUST50')).toBe(true);

      // Verify markAsRead was invoked
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(whatsappPromo.key);
      }
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(whatsappPromo.key);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('routes promotional SMS notification and invokes markAsRead', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const smsPromo: RawNotificationPayload = {
        id: 'sms-promo-1',
        key: '0|com.google.android.apps.messaging|301|null|10003',
        packageName: 'com.google.android.apps.messaging',
        title: 'AX-MYNTRA',
        text: 'Exclusive Sale! Flat 40% off on all sneakers with code SNEAK40. Hurry, ends tonight!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(smsPromo);
      });

      // Verify deal is stored in Deals Radar
      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.code === 'SNEAK40')).toBe(true);

      // Verify markAsRead was invoked
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(smsPromo.key);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('e-commerce promo invokes dismissNotification without marking as read', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const swiggyPromo: RawNotificationPayload = {
        id: 'swiggy-promo-1',
        key: '0|com.swiggy.android|401|null|10004',
        packageName: 'com.swiggy.android',
        title: 'Swiggy',
        text: 'Craving biryani? Use code SWIGGYIT to get 50% off up to Rs 100!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(swiggyPromo);
      });

      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(swiggyPromo.key);
      }
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).not.toContain(swiggyPromo.key);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('renders notification-access-alert-banner when permission is not granted', async () => {
      sensoryBridge.setMockPermissionGranted?.(false);

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const alertBanner = renderer.root.findByProps({ testID: 'notification-access-alert-banner' });
      expect(alertBanner).toBeDefined();

      const reqSpy = jest.spyOn(sensoryBridge, 'requestPermission');
      await act(async () => {
        alertBanner.props.onPress();
      });

      expect(reqSpy).toHaveBeenCalled();
      reqSpy.mockRestore();

      sensoryBridge.setMockPermissionGranted?.(true);
      act(() => {
        renderer.unmount();
      });
    });

    test('processActiveNotifications and openNotificationListenerSettings methods succeed', async () => {
      const activeSuccess = await sensoryBridge.processActiveNotifications();
      expect(activeSuccess).toBe(true);

      const settingsSuccess = await sensoryBridge.openNotificationListenerSettings();
      expect(settingsSuccess).toBe(true);
    });

    test('routes promotional WhatsApp notification with plural offers and marketing phrasing, marks as read', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const whatsappPromoPlural: RawNotificationPayload = {
        id: 'whatsapp-promo-plural-1',
        key: '0|com.whatsapp|202|null|10005',
        packageName: 'com.whatsapp',
        title: 'Domino’s Pizza',
        text: 'Exclusive offers! Flash sales are live with huge discounts on gourmet meals. Shop now!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(whatsappPromoPlural);
      });

      // Verify deal extracted
      const vouchers = dealsStorageService.getVouchers();
      expect(vouchers.some((v) => v.merchant.includes("Domino"))).toBe(true);

      // Verify mark-as-read was invoked
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(whatsappPromoPlural.key);
      }
      if (sensoryBridge.getMockDismissedKeys) {
        expect(sensoryBridge.getMockDismissedKeys()).toContain(whatsappPromoPlural.key);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('routes promotional SMS from Truecaller (com.truecaller) with plural discounts and marks as read', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen currentTime={fixedNow} />
          </ThemeProvider>
        );
      });

      const truecallerSms: RawNotificationPayload = {
        id: 'truecaller-sms-1',
        key: '0|com.truecaller|302|null|10006',
        packageName: 'com.truecaller',
        title: 'AJIO Deals',
        text: 'Special offers! Mega discounts across all apparel. Avail this offer today!',
        timestamp: fixedNow.getTime(),
        postTime: fixedNow.getTime(),
      };

      await act(async () => {
        await sensoryBridge.simulateNotification(truecallerSms);
      });

      // Verify mark-as-read called for Truecaller SMS
      if (sensoryBridge.getMockMarkedAsReadKeys) {
        expect(sensoryBridge.getMockMarkedAsReadKeys()).toContain(truecallerSms.key);
      }

      act(() => {
        renderer.unmount();
      });
    });

    test('isMessagingPackage helper accurately detects WhatsApp, SMS, and messaging variants', () => {
      expect(isMessagingPackage('com.whatsapp')).toBe(true);
      expect(isMessagingPackage('com.whatsapp.w4b')).toBe(true);
      expect(isMessagingPackage('com.google.android.apps.messaging')).toBe(true);
      expect(isMessagingPackage('com.samsung.android.messaging')).toBe(true);
      expect(isMessagingPackage('com.android.mms')).toBe(true);
      expect(isMessagingPackage('com.oneplus.mms')).toBe(true);
      expect(isMessagingPackage('com.motorola.messaging')).toBe(true);
      expect(isMessagingPackage('com.truecaller')).toBe(true);
      expect(isMessagingPackage('com.sonyericsson.conversations')).toBe(true);

      // Non-messaging
      expect(isMessagingPackage('com.swiggy.android')).toBe(false);
      expect(isMessagingPackage('com.amazon.mShop.android.shopping')).toBe(false);
      expect(isMessagingPackage(undefined)).toBe(false);
    });
  });
});
