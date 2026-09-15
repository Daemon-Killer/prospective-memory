/**
 * Remy Reminders - Swiss Void UI Interaction & Visual State Adversarial Stress Suite
 * Milestone 2 Challenger 2 Verification Battery
 *
 * Adversarially challenges Swiss Void UI components (SensoryInboxShelf & DealsRadarScreen):
 * 1. Dynamic shelf collapse/expand with 0, 1, 50, 200 items.
 * 2. Rapid multi-tap prevention on action buttons ([Accept] & [Dismiss]).
 * 3. 1-tap copy clipboard visual feedback timer and haptic trigger.
 * 4. Tab filtering across Active, All, and Expired vouchers with varied expiry.
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Clipboard, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

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

// Helper to recursively extract all text from react-test-renderer node
function getTextContent(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (node.props && node.props.children) return getTextContent(node.props.children);
  return '';
}

// Mock clipboard
jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});

describe('Milestone 2 Challenger 2: Swiss Void UI Adversarial Stress Battery', () => {
  const baseNow = new Date(2026, 8, 14, 12, 0, 0);
  const oneHour = 3600 * 1000;
  const oneDay = 24 * 3600 * 1000;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.clearAllMocks();
    (Haptics.selectionAsync as jest.Mock).mockImplementation(async () => {});
    (Haptics.impactAsync as jest.Mock).mockImplementation(async () => {});
    (Haptics.notificationAsync as jest.Mock).mockImplementation(async () => {});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // =========================================================================
  // SECTION 1: Dynamic Shelf Collapse/Expand Stress (0, 1, 50, 200 items)
  // =========================================================================
  describe('Area 1: Dynamic Shelf Collapse & Expand Scalability', () => {
    it('returns null (0-height footprint) when empty or with exclusively non-pending items', async () => {
      let renderer: any = null;

      // Case 1: Empty array
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

      // Case 2: Array with non-pending items
      const nonPendingSuggestions: SensorySuggestion[] = [
        {
          id: 'np-1',
          title: 'Completed task',
          actionVerb: 'Finish',
          originalText: 'Completed',
          inferredDueDate: '2026-09-14T18:00:00.000Z',
          armed: true,
          sourcePackage: 'com.app.test',
          category: 'general',
          confidence: 0.9,
          tags: [],
          createdAt: '2026-09-14T10:00:00.000Z',
          status: 'accepted' as any,
        },
        {
          id: 'np-2',
          title: 'Dismissed task',
          actionVerb: 'Skip',
          originalText: 'Dismissed',
          inferredDueDate: '2026-09-14T19:00:00.000Z',
          armed: true,
          sourcePackage: 'com.app.test',
          category: 'general',
          confidence: 0.9,
          tags: [],
          createdAt: '2026-09-14T10:00:00.000Z',
          status: 'dismissed' as any,
        },
      ];

      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={nonPendingSuggestions}
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

    it('1-item boundary: renders cleanly, pads counter to "01", and transitions expanded <-> collapsed', async () => {
      const singleSuggestion: SensorySuggestion[] = [
        {
          id: 'single-1',
          title: 'Pick up laundry from laundromat',
          actionVerb: 'Collect',
          originalText: 'Laundry ready for pickup',
          inferredDueDate: '2026-09-14T17:00:00.000Z',
          armed: true,
          sourcePackage: 'com.clean.laundry',
          sourceAppName: 'QuickDry',
          category: 'personal',
          confidence: 0.99,
          tags: ['laundry'],
          createdAt: '2026-09-14T10:00:00.000Z',
          status: 'pending',
        },
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={singleSuggestion}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // Shelf container & header
      expect(renderer.root.findByProps({ testID: 'sensory-inbox-shelf' })).toBeDefined();
      const countNode = renderer.root.findByProps({ testID: 'sensory-shelf-count' });
      expect(getTextContent(countNode)).toBe('01');

      // 1 card rendered
      expect(renderer.root.findByProps({ testID: 'suggestion-card-single-1' })).toBeDefined();
      expect(getTextContent(renderer.root.findByProps({ testID: 'suggestion-verb-single-1' }))).toBe('COLLECT');
      expect(getTextContent(renderer.root.findByProps({ testID: 'suggestion-source-single-1' }))).toBe('QUICKDRY');

      // Collapse via header toggle
      const toggleBtn = renderer.root.findByProps({ testID: 'sensory-shelf-toggle' });
      expect(getTextContent(toggleBtn)).toBe('COLLAPSE ▲');
      act(() => {
        toggleBtn.props.onPress();
      });
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

      // Collapsed bar check
      const collapsedBar = renderer.root.findByProps({ testID: 'sensory-shelf-collapsed-bar' });
      expect(getTextContent(collapsedBar)).toBe('[1 CANDIDATES WAITING] · TAP TO REVIEW INTENTIONS');
      expect(renderer.root.findAllByProps({ testID: 'suggestion-card-single-1' }).length).toBe(0);

      // Re-expand via collapsed bar
      act(() => {
        collapsedBar.props.onPress();
      });
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
      expect(renderer.root.findByProps({ testID: 'suggestion-card-single-1' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('50-items stress: handles bulk data, tabulates counter to "50", and survives rapid 10x collapse/expand cycles', async () => {
      const suggestions50: SensorySuggestion[] = Array.from({ length: 50 }, (_, i) => ({
        id: `sug-50-${i}`,
        title: `Dynamic prospective intention #${i + 1}`,
        actionVerb: i % 2 === 0 ? 'Review' : 'Schedule',
        originalText: `Original reminder text for item #${i + 1}`,
        inferredDueDate: new Date(2026, 8, 14, 13 + (i % 8), (i * 7) % 60).toISOString(),
        armed: i % 3 !== 0,
        sourcePackage: `com.merchant.service${i % 5}`,
        category: i % 2 === 0 ? 'delivery' : 'bill',
        confidence: 0.85 + (i % 15) * 0.01,
        tags: [`tag-${i}`],
        createdAt: '2026-09-14T09:00:00.000Z',
        status: 'pending',
      }));

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions50}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // Count badge formatting
      const countNode = renderer.root.findByProps({ testID: 'sensory-shelf-count' });
      expect(getTextContent(countNode)).toBe('50');

      // Verify all 50 cards exist
      for (let i = 0; i < 50; i++) {
        expect(renderer.root.findByProps({ testID: `suggestion-card-sug-50-${i}` })).toBeDefined();
      }

      // Execute 10 rapid toggles between collapsed and expanded
      for (let cycle = 0; cycle < 10; cycle++) {
        if (cycle % 2 === 0) {
          // Collapse
          const toggle = renderer.root.findByProps({ testID: 'sensory-shelf-toggle' });
          act(() => {
            toggle.props.onPress();
          });
          expect(renderer.root.findByProps({ testID: 'sensory-shelf-collapsed-bar' })).toBeDefined();
          expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-50-0' }).length).toBe(0);
        } else {
          // Re-expand
          const collapsedBar = renderer.root.findByProps({ testID: 'sensory-shelf-collapsed-bar' });
          act(() => {
            collapsedBar.props.onPress();
          });
          expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-50-0' }).length).toBeGreaterThan(0);
        }
      }

      // Final state should be expanded
      expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-50-0' }).length).toBeGreaterThan(0);
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(10);

      act(() => {
        renderer.unmount();
      });
    });

    it('200-items extreme stress: renders 200 items without degradation and handles dynamic count transitions (200 -> 50 -> 1 -> 0 -> 200)', async () => {
      const generateSuggestions = (count: number): SensorySuggestion[] =>
        Array.from({ length: count }, (_, i) => ({
          id: `sug-200-${i}`,
          title: `Bulk intention task #${i + 1}`,
          actionVerb: 'Verify',
          originalText: `Text #${i + 1}`,
          inferredDueDate: new Date(baseNow.getTime() + 2 * oneHour).toISOString(),
          armed: true,
          sourcePackage: 'com.bulk.provider',
          category: 'general',
          confidence: 0.95,
          tags: ['stress'],
          createdAt: '2026-09-14T09:00:00.000Z',
          status: 'pending',
        }));

      let renderer: any = null;
      const suggestions200 = generateSuggestions(200);

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions200}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // Badge displays "200"
      const countNode = renderer.root.findByProps({ testID: 'sensory-shelf-count' });
      expect(getTextContent(countNode)).toBe('200');

      // Sample first, middle, last cards
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-0' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-99' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-199' })).toBeDefined();

      // Dynamic reduction to 50 items
      const suggestions50 = generateSuggestions(50);
      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions50}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });
      expect(getTextContent(renderer.root.findByProps({ testID: 'sensory-shelf-count' }))).toBe('50');
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-49' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-200-50' }).length).toBe(0);

      // Dynamic reduction to 1 item
      const suggestions1 = generateSuggestions(1);
      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions1}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });
      expect(getTextContent(renderer.root.findByProps({ testID: 'sensory-shelf-count' }))).toBe('01');
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-0' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'suggestion-card-sug-200-1' }).length).toBe(0);

      // Dynamic reduction to 0 items -> returns null
      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[]}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });
      expect(renderer.toJSON()).toBeNull();

      // Dynamic expansion back from 0 to 200 items
      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={suggestions200}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });
      expect(renderer.root.findByProps({ testID: 'sensory-shelf-count' }).props.children.props.children).toBe('200');
      expect(renderer.root.findByProps({ testID: 'suggestion-card-sug-200-199' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('handles malformed, nullable, and edge-case suggestion attributes gracefully', () => {
      // Empty actionVerb defaults to TASK
      const fallbackSuggestion: SensorySuggestion = {
        id: 'fallback-1',
        title: 'Undisclosed task title',
        actionVerb: '' as any,
        originalText: 'Raw text',
        inferredDueDate: 'unparseable-date',
        armed: false,
        sourcePackage: '',
        category: 'general',
        confidence: 0.5,
        tags: [],
        createdAt: '2026-09-14T00:00:00.000Z',
        status: 'pending',
      };

      let renderer: any = null;
      act(() => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[fallbackSuggestion]}
              onAccept={jest.fn()}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      expect(renderer.root.findByProps({ testID: 'suggestion-verb-fallback-1' }).props.children).toBe('TASK');
      expect(renderer.root.findByProps({ testID: 'suggestion-source-fallback-1' }).props.children).toBe('APP');
      expect(renderer.root.findByProps({ testID: 'suggestion-time-fallback-1' }).props.children).toBe('📥 INBOX QUEUE');

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // SECTION 2: Rapid Multi-Tap Prevention on Action Buttons
  // =========================================================================
  describe('Area 2: Rapid Multi-Tap Prevention & Card-Level Lockouts', () => {
    const testSuggestion: SensorySuggestion = {
      id: 'tap-sug-1',
      title: 'Review flight tickets to Zurich',
      actionVerb: 'Check-in',
      originalText: 'Web check-in open',
      inferredDueDate: '2026-09-14T19:00:00.000Z',
      armed: true,
      sourcePackage: 'com.swiss.airlines',
      sourceAppName: 'SWISS',
      category: 'travel',
      confidence: 0.98,
      tags: ['flight'],
      createdAt: '2026-09-14T08:00:00.000Z',
      status: 'pending',
    };

    it('locks out both [Accept] and [Dismiss] during async onAccept execution and fires haptic', async () => {
      let resolveAccept: () => void = () => {};
      const delayedAcceptPromise = new Promise<void>((resolve) => {
        resolveAccept = resolve;
      });
      const mockAccept = jest.fn().mockReturnValue(delayedAcceptPromise);

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[testSuggestion]}
              onAccept={mockAccept}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-tap-sug-1' });
      const dismissBtn = renderer.root.findByProps({ testID: 'dismiss-button-tap-sug-1' });

      expect(acceptBtn.props.disabled).toBe(false);
      expect(dismissBtn.props.disabled).toBe(false);

      // Trigger first accept tap
      let tapPromise: any = null;
      act(() => {
        tapPromise = acceptBtn.props.onPress();
      });

      // Verify immediate disabled state on BOTH action buttons
      expect(acceptBtn.props.disabled).toBe(true);
      expect(dismissBtn.props.disabled).toBe(true);

      // Verify success haptic trigger
      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);

      // Resolve async operation
      await act(async () => {
        resolveAccept();
        await tapPromise;
      });

      // Verify callback was invoked exactly once
      expect(mockAccept).toHaveBeenCalledTimes(1);
      expect(mockAccept).toHaveBeenCalledWith('tap-sug-1');

      // Disabled state resets
      expect(acceptBtn.props.disabled).toBe(false);
      expect(dismissBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });

    it('locks out both buttons during async onDismiss execution and fires light impact haptic', async () => {
      let resolveDismiss: () => void = () => {};
      const delayedDismissPromise = new Promise<void>((resolve) => {
        resolveDismiss = resolve;
      });
      const mockDismiss = jest.fn().mockReturnValue(delayedDismissPromise);

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[testSuggestion]}
              onAccept={jest.fn()}
              onDismiss={mockDismiss}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-tap-sug-1' });
      const dismissBtn = renderer.root.findByProps({ testID: 'dismiss-button-tap-sug-1' });

      let tapPromise: any = null;
      act(() => {
        tapPromise = dismissBtn.props.onPress();
      });

      // Verify disabled state while in flight
      expect(dismissBtn.props.disabled).toBe(true);
      expect(acceptBtn.props.disabled).toBe(true);
      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);

      // Resolve async operation
      await act(async () => {
        resolveDismiss();
        await tapPromise;
      });

      expect(mockDismiss).toHaveBeenCalledTimes(1);
      expect(mockDismiss).toHaveBeenCalledWith('tap-sug-1');
      expect(dismissBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });

    it('recovers cleanly and unlocks buttons even if onAccept throws an unhandled rejection', async () => {
      let rejectAccept: (err: any) => void = () => {};
      const failingPromise = new Promise<void>((_, reject) => {
        rejectAccept = reject;
      });
      const mockAccept = jest.fn().mockReturnValue(failingPromise);

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={[testSuggestion]}
              onAccept={mockAccept}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const acceptBtn = renderer.root.findByProps({ testID: 'accept-button-tap-sug-1' });
      let tapPromise: any = null;

      act(() => {
        tapPromise = acceptBtn.props.onPress();
      });
      expect(acceptBtn.props.disabled).toBe(true);

      // Trigger rejection and wait for finally handler
      await act(async () => {
        rejectAccept(new Error('Simulated network storage failure'));
        try {
          await tapPromise;
        } catch {
          // Handled
        }
      });

      // Verify that finally block cleared processingId, restoring button state
      expect(acceptBtn.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });

    it('isolates card processing state: tapping Card 1 does NOT disable Card 2 buttons', async () => {
      const multiSuggestions: SensorySuggestion[] = [
        { ...testSuggestion, id: 'multi-card-1' },
        { ...testSuggestion, id: 'multi-card-2', title: 'Second intention' },
      ];

      let resolveCard1: () => void = () => {};
      const card1Promise = new Promise<void>((res) => {
        resolveCard1 = res;
      });
      const onAccept = jest.fn().mockImplementation((id: string) => {
        if (id === 'multi-card-1') return card1Promise;
        return Promise.resolve();
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <SensoryInboxShelf
              suggestions={multiSuggestions}
              onAccept={onAccept}
              onDismiss={jest.fn()}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const card1Accept = renderer.root.findByProps({ testID: 'accept-button-multi-card-1' });
      const card2Accept = renderer.root.findByProps({ testID: 'accept-button-multi-card-2' });

      // Click Card 1
      let tapPromise: any = null;
      act(() => {
        tapPromise = card1Accept.props.onPress();
      });

      // Card 1 is disabled; Card 2 remains enabled!
      expect(card1Accept.props.disabled).toBe(true);
      expect(card2Accept.props.disabled).toBe(false);

      // Resolve Card 1
      await act(async () => {
        resolveCard1();
        await tapPromise;
      });

      expect(card1Accept.props.disabled).toBe(false);
      expect(card2Accept.props.disabled).toBe(false);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // SECTION 3: 1-Tap Copy Clipboard Visual Feedback Timer & Haptics
  // =========================================================================
  describe('Area 3: 1-Tap Clipboard Copy, Timer Precision, and Haptic Feedback', () => {
    const mockVouchers: VoucherItem[] = [
      {
        id: 'v-clip-1',
        merchant: 'Swiggy',
        code: 'SWIGGYIT',
        discount: '50% OFF',
        discountType: 'percentage',
        description: '50% OFF up to ₹100',
        expiryDate: '2026-09-14T23:59:59.000Z',
        sourcePackage: 'com.swiggy.android',
        rawNotificationText: 'SWIGGYIT',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      {
        id: 'v-clip-2',
        merchant: 'Uber',
        code: 'UBER50',
        discount: '₹50 OFF',
        discountType: 'flat',
        description: '₹50 OFF on next 2 rides',
        expiryDate: '2026-09-15T23:59:59.000Z',
        sourcePackage: 'com.ubercab',
        rawNotificationText: 'UBER50',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 1,
      },
    ];

    it('triggers Medium haptic pulse and populates Clipboard.setString on 1-tap copy', async () => {
      const onCopyVoucher = jest.fn();
      let renderer: any = null;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={mockVouchers}
              onCopyVoucher={onCopyVoucher}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const copyBtn = renderer.root.findByProps({ testID: 'copy-code-button-v-clip-1' });
      await act(async () => {
        await copyBtn.props.onPress();
      });

      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
      expect(Clipboard.setString).toHaveBeenCalledWith('SWIGGYIT');
      expect(onCopyVoucher).toHaveBeenCalledWith('v-clip-1');

      act(() => {
        renderer.unmount();
      });
    });

    it('visual badge lifecycle: renders COPIED! ✓ for exactly 2500ms and restores copy button', async () => {
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

      // Initially, copy button exists and badge does not
      expect(renderer.root.findAllByProps({ testID: 'voucher-copied-badge-v-clip-1' }).length).toBe(0);
      const copyBtn = renderer.root.findByProps({ testID: 'copy-code-button-v-clip-1' });

      // Tap copy
      await act(async () => {
        await copyBtn.props.onPress();
      });

      // Immediately: Badge visible, copy button gone
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-clip-1' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'copy-code-button-v-clip-1' }).length).toBe(0);

      // Advance by 2400ms: Badge still visible
      act(() => {
        jest.advanceTimersByTime(2400);
      });
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-clip-1' })).toBeDefined();

      // Advance remaining 100ms (total 2500ms): Badge unmounts, copy button returns
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(renderer.root.findAllByProps({ testID: 'voucher-copied-badge-v-clip-1' }).length).toBe(0);
      expect(renderer.root.findByProps({ testID: 'copy-code-button-v-clip-1' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('interleaved multi-voucher copy sequence: preserves active badge without premature timer cancellation', async () => {
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

      // t = 0: Copy voucher 1
      const copyBtn1 = renderer.root.findByProps({ testID: 'copy-code-button-v-clip-1' });
      await act(async () => {
        await copyBtn1.props.onPress();
      });
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-clip-1' })).toBeDefined();

      // t = 1000ms: Copy voucher 2
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      const copyBtn2 = renderer.root.findByProps({ testID: 'copy-code-button-v-clip-2' });
      await act(async () => {
        await copyBtn2.props.onPress();
      });
      // Voucher 2 is now active
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-clip-2' })).toBeDefined();

      // Advance 1500ms (t = 2500ms total, when voucher 1's timer fires)
      // Because recentlyCopiedId === 'v-clip-2', voucher 1's timer handler must NOT clear voucher 2!
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-clip-2' })).toBeDefined();

      // Advance 1000ms (t = 3500ms total, when voucher 2's timer fires)
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(renderer.root.findAllByProps({ testID: 'voucher-copied-badge-v-clip-2' }).length).toBe(0);
      expect(renderer.root.findByProps({ testID: 'copy-code-button-v-clip-2' })).toBeDefined();

      act(() => {
        renderer.unmount();
      });
    });

    it('handles clipboard errors and edge-case promo codes (emojis, punctuation) without crashing', async () => {
      const specialVoucher: VoucherItem = {
        id: 'v-special',
        merchant: 'Special Merchant',
        code: '🎉#SPECIAL-100%_OFF!',
        discount: 'FREE',
        discountType: 'percentage',
        description: 'Special free voucher',
        expiryDate: '2026-09-15T00:00:00.000Z',
        sourcePackage: 'com.special.app',
        rawNotificationText: 'Special code',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      };

      // Force onCopyVoucher to reject
      const onCopyVoucher = jest.fn().mockRejectedValue(new Error('Simulated telemetry failure'));

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={[specialVoucher]}
              onCopyVoucher={onCopyVoucher}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const copyBtn = renderer.root.findByProps({ testID: 'copy-code-button-v-special' });
      await act(async () => {
        await copyBtn.props.onPress();
      });

      expect(Clipboard.setString).toHaveBeenCalledWith('🎉#SPECIAL-100%_OFF!');
      expect(renderer.root.findByProps({ testID: 'voucher-copied-badge-v-special' })).toBeDefined();

      // Ensure timer clears cleanly
      act(() => {
        jest.advanceTimersByTime(2500);
      });
      expect(renderer.root.findAllByProps({ testID: 'voucher-copied-badge-v-special' }).length).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });
  });

  // =========================================================================
  // SECTION 4: Tab Filtering Across Active, All, and Expired Vouchers
  // =========================================================================
  describe('Area 4: Tab Filtering Matrix across Diverse Expiry Conditions', () => {
    // 10 vouchers spanning all expiry permutations (strictly relative to baseNow)
    const heterogeneousVouchers: VoucherItem[] = [
      // 1. Future date (Tomorrow) -> Active
      {
        id: 'v-future-1',
        merchant: 'Amazon',
        code: 'AMAZON10',
        discount: '10% OFF',
        discountType: 'percentage',
        description: '10% OFF on electronics',
        expiryDate: new Date(baseNow.getTime() + oneDay).toISOString(),
        sourcePackage: 'in.amazon.mShop.android.shopping',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 2. Future date (Later today) -> Active
      {
        id: 'v-future-2',
        merchant: 'Blinkit',
        code: 'BLINK15',
        discount: '15% OFF',
        discountType: 'percentage',
        description: '15% OFF on groceries',
        expiryDate: new Date(baseNow.getTime() + 4 * oneHour).toISOString(),
        sourcePackage: 'com.grofers.customerapp',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 3. Past date (Yesterday) -> Expired
      {
        id: 'v-past-1',
        merchant: 'Zomato',
        code: 'ZOMATO50',
        discount: '50% OFF',
        discountType: 'percentage',
        description: '50% OFF on dinner',
        expiryDate: new Date(baseNow.getTime() - oneDay).toISOString(),
        sourcePackage: 'com.application.zomato',
        rawNotificationText: '',
        createdAt: '2026-09-13T08:00:00.000Z',
        updatedAt: '2026-09-13T08:00:00.000Z',
        copiedCount: 0,
      },
      // 4. Past date (Earlier today) -> Expired
      {
        id: 'v-past-2',
        merchant: 'Zepto',
        code: 'ZEPTO30',
        discount: '30% OFF',
        discountType: 'percentage',
        description: '30% OFF up to ₹100',
        expiryDate: new Date(baseNow.getTime() - 2 * oneHour).toISOString(),
        sourcePackage: 'com.zepto.shopping',
        rawNotificationText: '',
        createdAt: '2026-09-14T06:00:00.000Z',
        updatedAt: '2026-09-14T06:00:00.000Z',
        copiedCount: 0,
      },
      // 5. Null expiry -> Active (indefinite)
      {
        id: 'v-null-exp',
        merchant: 'Dominos',
        code: 'PIZZA20',
        discount: '20% OFF',
        discountType: 'percentage',
        description: '20% OFF on pizza',
        expiryDate: null,
        sourcePackage: 'com.dominos.app',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 6. Invalid expiry date -> Active (fallback)
      {
        id: 'v-invalid-exp',
        merchant: 'KFC',
        code: 'KFCWINGS',
        discount: 'Flat ₹100',
        discountType: 'flat',
        description: 'Flat ₹100 OFF on wings',
        expiryDate: 'invalid-iso-string',
        sourcePackage: 'com.kfc.app',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 7. Explicit isExpired: true -> Expired
      {
        id: 'v-flag-expired',
        merchant: 'Flipkart',
        code: 'BIGBILLION',
        discount: '40% OFF',
        discountType: 'percentage',
        description: '40% OFF on BBD sale',
        expiryDate: new Date(baseNow.getTime() + 5 * oneDay).toISOString(), // future date, but flagged isExpired
        isExpired: true,
        sourcePackage: 'com.flipkart.android',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 8. Explicit isExpired: false -> Active
      {
        id: 'v-flag-active',
        merchant: 'Myntra',
        code: 'MYNTRA500',
        discount: '₹500 OFF',
        discountType: 'flat',
        description: '₹500 OFF on apparel',
        expiryDate: new Date(baseNow.getTime() - 5 * oneDay).toISOString(), // past date, but pre-cleansed isExpired: false
        isExpired: false,
        sourcePackage: 'com.myntra.android',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 9. Indefinite 2 -> Active
      {
        id: 'v-indefinite-2',
        merchant: 'Airtel',
        code: 'AIRTELRECHARGE',
        discount: '₹20 CASHBACK',
        discountType: 'cashback',
        description: '₹20 cashback on recharge',
        expiryDate: null,
        sourcePackage: 'com.airtel.thanks',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
      // 10. Future date 3 -> Active
      {
        id: 'v-future-3',
        merchant: 'UberEats',
        code: 'EATS25',
        discount: '25% OFF',
        discountType: 'percentage',
        description: '25% OFF on your meal',
        expiryDate: new Date(baseNow.getTime() + 2 * oneDay).toISOString(),
        sourcePackage: 'com.ubercab.eats',
        rawNotificationText: '',
        createdAt: '2026-09-14T08:00:00.000Z',
        updatedAt: '2026-09-14T08:00:00.000Z',
        copiedCount: 0,
      },
    ];

    // Summary of expectation:
    // Active: v-future-1, v-future-2, v-null-exp, v-invalid-exp, v-flag-active, v-indefinite-2, v-future-3 => 7 items
    // Expired: v-past-1, v-past-2, v-flag-expired => 3 items
    // Total: 10 items

    it('correctly categorizes active vs expired vouchers in tab ledger counts: ACTIVE [7], ALL [10], EXPIRED [3]', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={heterogeneousVouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const activeTab = renderer.root.findByProps({ testID: 'filter-tab-active' });
      const allTab = renderer.root.findByProps({ testID: 'filter-tab-all' });
      const expiredTab = renderer.root.findByProps({ testID: 'filter-tab-expired' });

      expect(getTextContent(activeTab)).toBe('ACTIVE [7]');
      expect(getTextContent(allTab)).toBe('ALL [10]');
      expect(getTextContent(expiredTab)).toBe('EXPIRED [3]');

      act(() => {
        renderer.unmount();
      });
    });

    it('verifies strict card isolation when toggling between ACTIVE, EXPIRED, and ALL tabs', async () => {
      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={heterogeneousVouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // 1. By default ACTIVE tab is selected:
      // Active cards exist
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-future-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-null-exp' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-invalid-exp' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-flag-active' })).toBeDefined();
      // Expired cards must NOT exist
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-past-1' }).length).toBe(0);
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-past-2' }).length).toBe(0);
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-flag-expired' }).length).toBe(0);

      // 2. Switch to EXPIRED tab:
      const expiredTab = renderer.root.findByProps({ testID: 'filter-tab-expired' });
      act(() => {
        expiredTab.props.onPress();
      });

      // Expired cards exist with badges and faded opacity
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-past-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-past-2' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-flag-expired' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-expired-badge-v-past-1' })).toBeDefined();
      // Active cards must NOT exist
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-future-1' }).length).toBe(0);
      expect(renderer.root.findAllByProps({ testID: 'voucher-card-v-null-exp' }).length).toBe(0);

      // 3. Switch to ALL tab:
      const allTab = renderer.root.findByProps({ testID: 'filter-tab-all' });
      act(() => {
        allTab.props.onPress();
      });

      // Both active and expired cards exist together
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-future-1' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'voucher-card-v-past-1' })).toBeDefined();
      expect(renderer.root.findAllByProps({ testID: 'deals-empty-state' }).length).toBe(0);

      act(() => {
        renderer.unmount();
      });
    });

    it('renders Swiss Void empty state with dynamic stack indicator when a selected filter has 0 items', async () => {
      const onlyActiveVouchers: VoucherItem[] = [
        heterogeneousVouchers[0], // v-future-1
      ];

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={onlyActiveVouchers}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      // Switch to EXPIRED tab (which has 0 items)
      const expiredTab = renderer.root.findByProps({ testID: 'filter-tab-expired' });
      act(() => {
        expiredTab.props.onPress();
      });

      expect(renderer.root.findByProps({ testID: 'deals-empty-state' })).toBeDefined();
      expect(getTextContent(renderer.root.findByProps({ testID: 'filter-tab-expired' }))).toBe('EXPIRED [0]');

      act(() => {
        renderer.unmount();
      });
    });

    it('conditionally displays PURGE EXPIRED button only when expired items exist and triggers warning haptic', async () => {
      const onPurge = jest.fn();
      let renderer: any = null;

      // Case 1: With expired vouchers and onPurgeExpired passed
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={heterogeneousVouchers}
              onPurgeExpired={onPurge}
              currentTime={baseNow}
            />
          </ThemeProvider>
        );
      });

      const purgeBtn = renderer.root.findByProps({ testID: 'purge-expired-btn' });
      expect(purgeBtn).toBeDefined();
      const purgeBtnText = renderer.root.findByProps({ testID: 'purge-expired-button' });
      expect(getTextContent(purgeBtnText)).toBe('PURGE EXPIRED [3]');

      await act(async () => {
        await purgeBtn.props.onPress();
      });

      expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
      expect(onPurge).toHaveBeenCalledTimes(1);

      // Case 2: When 0 expired vouchers exist, purge button must not be rendered
      const onlyActiveVouchers: VoucherItem[] = [heterogeneousVouchers[0]];
      await act(async () => {
        renderer.update(
          <ThemeProvider initialMode="void">
            <DealsRadarScreen
              vouchers={onlyActiveVouchers}
              onPurgeExpired={onPurge}
              currentTime={baseNow}
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
});
