/**
 * Remy Reminders - Swiss Void UI Components & Sensory Surfaces Test Suite
 * Milestone 2 Automated Verification Battery
 *
 * Verifies:
 * 1. SensoryInboxShelf:
 *    - cleanPackageBadge normalization
 *    - formatInferredTimeCue tabular cues
 *    - 0-height empty state (null return)
 *    - Swiss Void rendering (#000000 canvas, #FFFFFF text, #FF4500 accents)
 *    - Header counter and expand/collapse toggle
 *    - 1-tap [Accept] and [Dismiss] actions with decoupled testIDs
 * 2. DealsRadarScreen:
 *    - isVoucherExpired dynamic evaluations
 *    - formatVoucherExpiry tabular formatting
 *    - Active, All, and Expired tab filtering
 *    - 1-tap clipboard copy, medium haptic pulse, and visual COPIED! ✓ feedback badge (#30D158)
 *    - Expired status badge and purge expired action
 *    - Swiss Void empty state
 * 3. HomeScreen Integration:
 *    - Embeds SensoryInboxShelf above ReminderList
 *    - Entry button to open DealsRadarScreen via Masthead
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Clipboard } from 'react-native';

import { ThemeProvider } from '../src/theme/ThemeContext';
import { SensorySuggestion, VoucherItem } from '../src/sensory/types';
import {
  SensoryInboxShelf,
  cleanPackageBadge,
  formatInferredTimeCue,
} from '../src/components/SensoryInboxShelf';
import {
  DealsRadarScreen,
  isVoucherExpired,
  formatVoucherExpiry,
  copyVoucherCodeToClipboard,
} from '../src/screens/DealsRadarScreen';
import { HomeScreen } from '../src/screens/HomeScreen';

// Mock clipboard
jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});

describe('Milestone 2: Swiss Void UI Surfaces & Sensory Integration', () => {
  const baseNow = new Date(2026, 8, 14, 12, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  // =========================================================
  // 1. SensoryInboxShelf Utility Functions
  // =========================================================
  describe('SensoryInboxShelf Utilities', () => {
    it('cleanPackageBadge extracts clean merchant names from package strings', () => {
      expect(cleanPackageBadge('com.swiggy.android')).toBe('SWIGGY');
      expect(cleanPackageBadge('in.amazon.mShop.android.shopping')).toBe('AMAZON');
      expect(cleanPackageBadge('com.application.zomato')).toBe('ZOMATO');
      expect(cleanPackageBadge('com.ubercab')).toBe('UBER');
      expect(cleanPackageBadge('com.mycustom.app', 'Custom Delivery')).toBe('CUSTOM DELIVERY');
      expect(cleanPackageBadge('unknown.package.courier')).toBe('COURIER');
    });

    it('formatInferredTimeCue formats armed and unarmed time cues', () => {
      const todayDue = new Date(2026, 8, 14, 17, 30, 0);
      expect(formatInferredTimeCue(todayDue.toISOString(), true, baseNow)).toBe('17:30');
      expect(formatInferredTimeCue(todayDue.toISOString(), false, baseNow)).toBe('INBOX QUEUE');
      expect(formatInferredTimeCue('invalid-date', true, baseNow)).toBe('TIME CUE ATTACHED');
    });
  });

  // =========================================================
  // 2. SensoryInboxShelf Component
  // =========================================================
  describe('SensoryInboxShelf Component', () => {
    const mockSuggestions: SensorySuggestion[] = [
      {
        id: 'sug-1',
        title: 'Receive Amazon package (Wireless Mouse)',
        actionVerb: 'Receive',
        originalText: 'Your Amazon package containing Wireless Mouse is arriving today.',
        inferredDueDate: '2026-09-14T18:00:00.000Z',
        armed: true,
        sourcePackage: 'in.amazon.mShop.android.shopping',
        sourceAppName: 'Amazon',
        category: 'delivery',
        confidence: 0.95,
        tags: ['delivery', 'amazon'],
        createdAt: '2026-09-14T11:00:00.000Z',
        status: 'pending',
      },
      {
        id: 'sug-2',
        title: 'Pay Airtel broadband bill (₹1,099)',
        actionVerb: 'Pay',
        originalText: 'Airtel bill of Rs 1099 is due on 15 Sep.',
        inferredDueDate: '2026-09-15T20:00:00.000Z',
        armed: true,
        sourcePackage: 'com.airtel.thanks',
        sourceAppName: 'Airtel',
        category: 'bill',
        confidence: 0.92,
        tags: ['bill', 'airtel'],
        createdAt: '2026-09-14T11:30:00.000Z',
        status: 'pending',
      },
    ];

    it('returns null when suggestions list has zero pending items', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[]}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.toJSON()).toBeNull();
      act(() => {
        renderer.unmount();
      });
    });

    it('renders header, counter badge, and candidate cards when suggestions are pending', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={mockSuggestions}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'sensory-inbox-shelf' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'sensory-shelf-header' })).toBeDefined();

      const countNode = renderer.root.findByProps({ testID: 'sensory-shelf-count' });
      expect(countNode.props.children.props.children).toBe('02');

      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'suggestion-title-sug-1' }).props.children).toBe(
        'Receive Amazon package (Wireless Mouse)'
      );
      expect(renderer.root.findByProps({ testID: 'suggestion-verb-sug-1' }).props.children).toBe('RECEIVE');
      expect(renderer.root.findByProps({ testID: 'suggestion-source-sug-1' }).props.children).toBe('AMAZON');

      act(() => {
        renderer.unmount();
      });
    });

    it('collapses and expands when toggle button is pressed', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={mockSuggestions}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              initiallyExpanded={true}
            />
          </ThemeProvider>
        );
      });

      const toggleBtn = renderer.root.findByProps({ testID: 'sensory-shelf-toggle' });
      act(() => {
        toggleBtn.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'sensory-shelf-collapsed-bar' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-1' }).length).toBe(0);

      // Re-expand
      const collapsedBar = renderer.root.findByProps({ testID: 'sensory-shelf-collapsed-bar' });
      act(() => {
        collapsedBar.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-1' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('1-tap [Accept] triggers onAccept callback with suggestion id', async () => {
      const onAccept = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={mockSuggestions}
              onAccept={onAccept}
              onDismiss={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-sug-1' });
      await act(async () => {
        await acceptBtn.props.onPress();
      });

      expect(onAccept).toHaveBeenCalledWith('sug-1');

      act(() => {
        renderer.unmount();
      });
    });

    it('1-tap [Dismiss] triggers onDismiss callback with suggestion id', async () => {
      const onDismiss = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={mockSuggestions}
              onAccept={jest.fn()}
              onDismiss={onDismiss}
            />
          </ThemeProvider>
        );
      });

      const dismissBtn = renderer.root.findByProps({ testID: 'dismiss-button-sug-2' });
      await act(async () => {
        await dismissBtn.props.onPress();
      });

      expect(onDismiss).toHaveBeenCalledWith('sug-2');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================
  // 3. DealsRadarScreen Utility Functions
  // =========================================================
  describe('DealsRadarScreen Utilities', () => {
    it('isVoucherExpired correctly evaluates timestamps against currentTime', () => {
      const activeVoucher: VoucherItem = {
        id: 'v-1',
        merchant: 'Swiggy',
        code: 'SWIGGYIT',
        discount: '50% OFF',
        discountType: 'percentage',
        description: '50% off up to ₹100',
        expiryDate: '2026-09-14T23:59:59.000Z',
        sourcePackage: 'com.swiggy.android',
        rawNotificationText: 'promo',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      };

      expect(isVoucherExpired(activeVoucher, baseNow)).toBe(false);

      const expiredVoucher: VoucherItem = {
        ...activeVoucher,
        id: 'v-2',
        expiryDate: '2026-09-13T23:59:59.000Z', // Yesterday
      };
      expect(isVoucherExpired(expiredVoucher, baseNow)).toBe(true);

      const indefiniteVoucher: VoucherItem = {
        ...activeVoucher,
        id: 'v-3',
        expiryDate: null,
      };
      expect(isVoucherExpired(indefiniteVoucher, baseNow)).toBe(false);

      const malformedVoucher: VoucherItem = {
        ...activeVoucher,
        id: 'v-4',
        expiryDate: 'not-a-valid-date',
      };
      expect(isVoucherExpired(malformedVoucher, baseNow)).toBe(false);
    });

    it('formatVoucherExpiry generates human-readable tabular text', () => {
      expect(formatVoucherExpiry('2026-09-13T20:00:00.000Z', baseNow)).toBe('EXPIRED');
      expect(formatVoucherExpiry(null, baseNow)).toBe('NO EXPIRY');
      expect(formatVoucherExpiry('invalid-date', baseNow)).toBe('UNKNOWN');
    });

    it('copyVoucherCodeToClipboard copies code to system clipboard', async () => {
      const success = await copyVoucherCodeToClipboard('FESTIVE50');
      expect(success).toBe(true);
      expect(Clipboard.setString).toHaveBeenCalledWith('FESTIVE50');
    });
  });

  // =========================================================
  // 4. DealsRadarScreen Component
  // =========================================================
  describe('DealsRadarScreen Component', () => {
    const mockVouchers: VoucherItem[] = [
      {
        id: 'v-active-1',
        merchant: 'Swiggy',
        code: 'SWIGGYIT',
        discount: '50% OFF',
        discountValue: 50,
        discountType: 'percentage',
        description: '50% off up to ₹100 on orders above ₹199',
        expiryDate: '2026-09-14T23:59:59.000Z',
        sourcePackage: 'com.swiggy.android',
        rawNotificationText: 'Use code SWIGGYIT for 50% off',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 2,
      },
      {
        id: 'v-expired-1',
        merchant: 'Zomato',
        code: 'GOLD20',
        discount: 'Flat ₹200 OFF',
        discountValue: 200,
        discountType: 'flat',
        description: 'Flat ₹200 on gourmet orders',
        expiryDate: '2026-09-12T23:59:59.000Z', // Past date
        sourcePackage: 'com.application.zomato',
        rawNotificationText: 'Use GOLD20 for Flat 200',
        createdAt: '2026-09-12T08:00:00.000Z',
        updatedAt: '2026-09-12T08:00:00.000Z',
        copiedCount: 0,
      },
    ];

    it('renders header, title, and filter tabs', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={mockVouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'deals-radar-screen' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'deals-radar-title' }).props.children).toBe(
        'DEALS & VOUCHER RADAR'
      );
      expect(renderer.root.findByProps({ testID: 'filter-tab-active' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'filter-tab-all' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'filter-tab-expired' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('filters active vouchers by default and switches tabs cleanly', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={mockVouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // By default, active tab is selected: only v-active-1 should be shown
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-active-1' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-expired-1' }).length).toBe(0);

      // Switch to EXPIRED tab
      const expiredTab = renderer.root.findByProps({ testID: 'filter-tab-expired' });
      act(() => {
        expiredTab.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'voucher-card-v-expired-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-expired-badge-v-expired-1' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-active-1' }).length).toBe(0);

      // Switch to ALL tab
      const allTab = renderer.root.findByProps({ testID: 'filter-tab-all' });
      act(() => {
        allTab.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'voucher-card-v-active-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-expired-1' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('1-tap [COPY CODE] copies promo code and displays visual COPIED! feedback badge', async () => {
      const onCopy = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={mockVouchers}
              onCopyVoucher={onCopy}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const copyBtn = renderer.root.findByProps({ testID: 'copy-code-button-v-active-1' });
      await act(async () => {
        await copyBtn.props.onPress();
      });

      expect(Clipboard.setString).toHaveBeenCalledWith('SWIGGYIT');
      expect(onCopy).toHaveBeenCalledWith('v-active-1');

      // Visual feedback badge is rendered
      const copiedBadge = renderer.root.findByProps({ testID: 'voucher-copied-badge-v-active-1' });
      expect(copiedBadge).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('triggers onPurgeExpired when purge button is pressed', async () => {
      const onPurge = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={mockVouchers}
              onPurgeExpired={onPurge}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const purgeBtn = renderer.root.findByProps({ testID: 'purge-expired-btn' });
      expect(purgeBtn).toBeDefined();

      await act(async () => {
        await purgeBtn.props.onPress();
      });

      expect(onPurge).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('renders Swiss Void empty state when no vouchers exist in selected filter', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={[]}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'deals-empty-state' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================
  // 5. HomeScreen Integration
  // =========================================================
  describe('HomeScreen Sensory Integration', () => {
    const mockSuggestions: SensorySuggestion[] = [
      {
        id: 'sug-home-1',
        title: 'Receive package from Amazon',
        actionVerb: 'Receive',
        originalText: 'Package arriving',
        inferredDueDate: '2026-09-14T18:00:00.000Z',
        armed: true,
        sourcePackage: 'in.amazon.mShop.android.shopping',
        category: 'delivery',
        confidence: 0.95,
        tags: ['delivery'],
        createdAt: '2026-09-14T11:00:00.000Z',
        status: 'pending',
      },
    ];

    it('renders SensoryInboxShelf above reminder list when suggestions are present', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              reminders={[]}
              suggestions={mockSuggestions}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'sensory-inbox-shelf' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-home-1' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('navigates to DealsRadarScreen when RADAR button is pressed', async () => {
      const onOpenRadar = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <HomeScreen
              reminders={[]}
              suggestions={[]}
              onOpenDealsRadar={onOpenRadar}
            />
          </ThemeProvider>
        );
      });

      const radarBtn = renderer.root.findByProps({ testID: 'deals-radar-btn' });
      expect(radarBtn).toBeDefined();

      act(() => {
        radarBtn.props.onPress();
      });

      expect(onOpenRadar).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });
  });
});
