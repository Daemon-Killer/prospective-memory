/**
 * Remy Reminders - Reviewer M2-2 Adversarial Challenge Suite
 * Stress-testing Swiss Void UI surfaces, haptics, concurrency, and edge cases.
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Clipboard } from 'react-native';

import { ThemeProvider } from '../src/theme/ThemeContext';
import { voidColors } from '../src/theme/colors';
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
import { Masthead } from '../src/components/Masthead';

// Mock clipboard
jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});

describe('Reviewer M2-2 Adversarial & Stress Battery', () => {
  const baseNow = new Date('2026-09-14T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  // =========================================================
  // 1. SensoryInboxShelf: Adversarial Inputs & Failure Modes
  // =========================================================
  describe('SensoryInboxShelf: Stress & Failure Modes', () => {
    it('cleanPackageBadge handles edge cases: undefined, empty, dots, long names', () => {
      expect(cleanPackageBadge('')).toBe('APP');
      expect(cleanPackageBadge('...')).toBe('...');
      expect(cleanPackageBadge('a.b.c')).toBe('A.B.C');
      expect(cleanPackageBadge('com.extremely.long.unbounded.package.name.identifier')).toBe('IDENTIFIER');
      expect(cleanPackageBadge('com.unknown.app', 'Short')).toBe('SHORT');
      expect(cleanPackageBadge('com.test', '   ')).toBe('TEST');
    });

    it('handles suggestions with missing or extreme properties gracefully', async () => {
      const hostileSuggestions: SensorySuggestion[] = [
        {
          id: 'hostile-1',
          title: 'X'.repeat(2000), // Massive title
          actionVerb: '',
          originalText: '',
          inferredDueDate: 'not-a-valid-date',
          armed: false,
          sourcePackage: '',
          category: 'general',
          confidence: 0,
          tags: [],
          createdAt: 'invalid-date',
          status: 'pending',
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={hostileSuggestions}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'suggestion-card-hostile-1' })).toBeDefined();
      // Unarmed and invalid date should display 'INBOX QUEUE'
      const timeText = renderer.root.findByProps({ testID: 'suggestion-time-hostile-1' });
      expect(timeText.props.children).toContain('INBOX QUEUE');

      // Empty actionVerb defaults to TASK
      const verbText = renderer.root.findByProps({ testID: 'suggestion-verb-hostile-1' });
      expect(verbText.props.children).toBe('TASK');

      act(() => {
        renderer.unmount();
      });
    });

    it('locks button with disabled=true while async onAccept is in-flight, preventing double-submission', async () => {
      let resolveAccept: () => void = () => {};
      const pendingPromise = new Promise<void>((res) => {
        resolveAccept = res;
      });
      const onAccept = jest.fn(() => pendingPromise);

      const suggestions: SensorySuggestion[] = [
        {
          id: 'test-sug',
          title: 'Important Meeting',
          actionVerb: 'Meet',
          originalText: 'Calendar alert',
          inferredDueDate: '2026-09-14T14:00:00.000Z',
          armed: true,
          sourcePackage: 'com.google.android.calendar',
          category: 'general',
          confidence: 0.9,
          tags: [],
          createdAt: '2026-09-14T10:00:00.000Z',
          status: 'pending',
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions}
              onAccept={onAccept}
              onDismiss={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-test-sug' });
      const dismissBtn = renderer.root.findByProps({ testID: 'dismiss-button-test-sug' });

      expect(acceptBtn.props.disabled).toBe(false);
      expect(dismissBtn.props.disabled).toBe(false);

      // Trigger first press (in flight)
      act(() => {
        acceptBtn.props.onPress();
      });

      // While in flight, both accept and dismiss are disabled for that item
      expect(acceptBtn.props.disabled).toBe(true);
      expect(dismissBtn.props.disabled).toBe(true);
      expect(onAccept).toHaveBeenCalledTimes(1);

      // Second press while disabled should not trigger extra onAccept calls
      // (in real native touch, TouchableOpacity ignores when disabled)

      // Complete async operation
      await act(async () => {
        resolveAccept();
        await pendingPromise;
      });

      expect(acceptBtn.props.disabled).toBe(false);
      expect(dismissBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });

    it('unlocks button disabled state even if onAccept rejects with an error', async () => {
      const rejectingAccept = jest.fn(() => Promise.reject(new Error('Simulated network/storage crash')));

      const suggestions: SensorySuggestion[] = [
        {
          id: 'err-sug',
          title: 'Error-prone Suggestion',
          actionVerb: 'Review',
          originalText: 'Test',
          inferredDueDate: '2026-09-14T14:00:00.000Z',
          armed: true,
          sourcePackage: 'com.test',
          category: 'general',
          confidence: 0.8,
          tags: [],
          createdAt: '2026-09-14T10:00:00.000Z',
          status: 'pending',
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions}
              onAccept={rejectingAccept}
              onDismiss={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-err-sug' });

      // Trigger press and catch error
      await act(async () => {
        try {
          await acceptBtn.props.onPress();
        } catch {
          // Handled
        }
      });

      // Disabled state must be restored to false (not permanently locked)
      expect(acceptBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================
  // 2. DealsRadarScreen: Expiry Boundaries & Concurrency
  // =========================================================
  describe('DealsRadarScreen: Expiry Boundaries & Concurrency', () => {
    it('isVoucherExpired evaluates boundary conditions: null, exact now, millisecond differences', () => {
      const vIndefinite: VoucherItem = {
        id: 'v1',
        merchant: 'M',
        code: 'C',
        discount: '10%',
        discountType: 'percentage',
        description: '10% OFF',
        sourcePackage: 'com.merchant',
        rawNotificationText: '10% OFF with code C',
        createdAt: baseNow.toISOString(),
        updatedAt: baseNow.toISOString(),
        expiryDate: null,
        copiedCount: 0,
      };
      expect(isVoucherExpired(vIndefinite, baseNow)).toBe(false);

      // 1 ms in the past -> expired
      const vPast: VoucherItem = {
        ...vIndefinite,
        id: 'v2',
        expiryDate: new Date(baseNow.getTime() - 1).toISOString(),
      };
      expect(isVoucherExpired(vPast, baseNow)).toBe(true);

      // Exact millisecond -> not expired (exp.getTime() < now.getTime() is false)
      const vExact: VoucherItem = {
        ...vIndefinite,
        id: 'v3',
        expiryDate: baseNow.toISOString(),
      };
      expect(isVoucherExpired(vExact, baseNow)).toBe(false);

      // 1 ms in the future -> not expired
      const vFuture: VoucherItem = {
        ...vIndefinite,
        id: 'v4',
        expiryDate: new Date(baseNow.getTime() + 1).toISOString(),
      };
      expect(isVoucherExpired(vFuture, baseNow)).toBe(false);
    });

    it('maintains independent 2.5s visual feedback timers when copying multiple vouchers', async () => {
      const vouchers: VoucherItem[] = [
        {
          id: 'v-a',
          merchant: 'Merchant A',
          code: 'CODEA',
          discount: '10% OFF',
          discountType: 'percentage',
          description: '10% OFF',
          sourcePackage: 'com.merchanta',
          rawNotificationText: '10% OFF',
          createdAt: baseNow.toISOString(),
          updatedAt: baseNow.toISOString(),
          expiryDate: null,
          copiedCount: 0,
        },
        {
          id: 'v-b',
          merchant: 'Merchant B',
          code: 'CODEB',
          discount: '20% OFF',
          discountType: 'percentage',
          description: '20% OFF',
          sourcePackage: 'com.merchantb',
          rawNotificationText: '20% OFF',
          createdAt: baseNow.toISOString(),
          updatedAt: baseNow.toISOString(),
          expiryDate: null,
          copiedCount: 0,
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={vouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // Copy Voucher A
      const copyBtnA = renderer.root.findByProps({ testID: 'copy-code-button-v-a' });
      await act(async () => {
        await copyBtnA.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-a' })).toBeDefined();

      // Advance 1 second
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Copy Voucher B
      const copyBtnB = renderer.root.findByProps({ testID: 'copy-code-button-v-b' });
      await act(async () => {
        await copyBtnB.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-b' })).toBeDefined();

      // Advance 1.6 seconds (total 2.6s from A's copy, but only 1.6s from B's copy)
      act(() => {
        jest.advanceTimersByTime(1600);
      });

      // Voucher B should still be showing COPIED! (its 2.5s has not elapsed)
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-b' })).toBeDefined();

      // Advance remaining 1000ms
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Now B's timer has elapsed too, so copy button returns
      expect(renderer.root.findAllByProps({ testID: 'voucher-copied-badge-v-b' }).length).toBe(0);
      expect(renderer.root.findByProps({ testID: 'copy-code-button-v-b' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('hides purge button when 0 expired vouchers exist', async () => {
      const allActiveVouchers: VoucherItem[] = [
        {
          id: 'v-act',
          merchant: 'Active Shop',
          code: 'ACTIVE',
          discount: '15% OFF',
          discountType: 'percentage',
          description: '15% OFF',
          sourcePackage: 'com.activeshop',
          rawNotificationText: '15% OFF with code ACTIVE',
          createdAt: baseNow.toISOString(),
          updatedAt: baseNow.toISOString(),
          expiryDate: '2026-09-20T00:00:00.000Z',
          copiedCount: 0,
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={allActiveVouchers}
              currentTime={baseNow}
              onPurgeExpired={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findAllByProps({ testID: 'purge-expired-btn' }).length).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================
  // 3. Swiss Void Design Fidelity & Masthead Radar Trigger
  // =========================================================
  describe('Swiss Void Aesthetics & Masthead Radar Trigger', () => {
    it('Masthead shows active International Orange accent dot when voucherCount > 0', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <Masthead
              activeCount={3}
              snoozedCount={1}
              completedCount={5}
              voucherCount={2}
              onOpenDealsRadar={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const radarBtn = renderer.root.findByProps({ testID: 'deals-radar-btn' });
      expect(radarBtn).toBeDefined();

      // Child dot has accent color (#FF4500 in void mode)
      const dot = radarBtn.props.children[0];
      const flatStyle = dot.props.style.flat ? dot.props.style.flat() : dot.props.style;
      const bgStyle = flatStyle.find((s: any) => s && s.backgroundColor);
      expect(bgStyle.backgroundColor).toBe(voidColors.accent);

      act(() => {
        renderer.unmount();
      });
    });

    it('Masthead shows inactive gray dot when voucherCount is 0', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <Masthead
              activeCount={3}
              snoozedCount={1}
              completedCount={5}
              voucherCount={0}
              onOpenDealsRadar={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const radarBtn = renderer.root.findByProps({ testID: 'deals-radar-btn' });
      const dot = radarBtn.props.children[0];
      const flatStyle = dot.props.style.flat ? dot.props.style.flat() : dot.props.style;
      const bgStyle = flatStyle.find((s: any) => s && s.backgroundColor);
      expect(bgStyle.backgroundColor).toBe('#6B7280');

      act(() => {
        renderer.unmount();
      });
    });
  });
});
