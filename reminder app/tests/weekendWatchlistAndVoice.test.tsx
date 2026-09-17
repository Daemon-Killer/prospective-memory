import React from 'react';
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import {
  notificationService,
  calculateNextFriday7PM,
  WEEKEND_WATCHLIST_NOTIFICATION_ID,
} from '../src/services/notificationService';
import { useNotifications } from '../src/hooks/useNotifications';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { Reminder } from '../src/types/reminder';
import { mockNotifications } from './mocks/mockNotifications';

import { ThemeProvider } from '../src/theme';

jest.mock('expo-notifications', () => {
  const { mockNotifications } = require('./mocks/mockNotifications');
  return mockNotifications;
});

describe('Weekend Watchlist Nudge & Voice Ingress Suite', () => {
  beforeEach(() => {
    mockNotifications.__reset();
    jest.clearAllMocks();
  });

  describe('1. Friday 7:00 PM Date Calculation', () => {
    it('calculates upcoming Friday 7:00 PM when today is Thursday', () => {
      // 2026-09-17 is a Thursday
      const thursday = new Date(2026, 8, 17, 10, 0, 0);
      const target = calculateNextFriday7PM(thursday);

      expect(target.getFullYear()).toBe(2026);
      expect(target.getMonth()).toBe(8);
      expect(target.getDate()).toBe(18); // Friday Sep 18
      expect(target.getHours()).toBe(19);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
      expect(target.getDay()).toBe(5); // Friday
    });

    it('returns today at 7:00 PM when called on Friday before 19:00', () => {
      // Friday Sep 18 at 14:30
      const fridayEarly = new Date(2026, 8, 18, 14, 30, 0);
      const target = calculateNextFriday7PM(fridayEarly);

      expect(target.getDate()).toBe(18);
      expect(target.getHours()).toBe(19);
      expect(target.getDay()).toBe(5);
    });

    it('schedules for next week Friday when called on Friday at or after 19:00', () => {
      // Friday Sep 18 at 19:00:00
      const fridayEvening = new Date(2026, 8, 18, 19, 0, 0);
      const target = calculateNextFriday7PM(fridayEvening);

      expect(target.getDate()).toBe(25); // Next Friday Sep 25
      expect(target.getHours()).toBe(19);
      expect(target.getDay()).toBe(5);
    });

    it('schedules for next Friday when called on Saturday', () => {
      // Saturday Sep 19 at 11:00
      const saturday = new Date(2026, 8, 19, 11, 0, 0);
      const target = calculateNextFriday7PM(saturday);

      expect(target.getDate()).toBe(25);
      expect(target.getHours()).toBe(19);
      expect(target.getDay()).toBe(5);
    });
  });

  describe('2. Weekend Watchlist Notification Scheduling', () => {
    it('schedules notification for Friday 7:00 PM with unwatched count', async () => {
      const now = new Date(2026, 8, 17, 12, 0, 0); // Thursday
      const notifId = await notificationService.scheduleWeekendWatchlistNotification(3, undefined, now);

      expect(notifId).toBeTruthy();
      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: '🎬 Weekend Watchlist',
            body: 'You have 3 unwatched titles queued',
            data: expect.objectContaining({
              screen: 'watchlist',
              type: 'watchlist',
              count: 3,
            }),
          }),
          trigger: expect.objectContaining({
            date: expect.any(Date),
          }),
        })
      );

      const triggerDate = (mockNotifications.scheduleNotificationAsync.mock.calls[0][0].trigger as any).date;
      expect(triggerDate.getDay()).toBe(5);
      expect(triggerDate.getHours()).toBe(19);
    });

    it('uses singular phrasing when exactly 1 title is queued', async () => {
      const now = new Date(2026, 8, 17, 12, 0, 0);
      await notificationService.scheduleWeekendWatchlistNotification(1, undefined, now);

      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            body: 'You have 1 unwatched title queued',
          }),
        })
      );
    });

    it('cancels scheduled notification when unwatched count drops to 0', async () => {
      await notificationService.scheduleWeekendWatchlistNotification(0);
      expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
    });

    it('reconciles notification automatically based on reminder list', async () => {
      const reminders: Reminder[] = [
        {
          id: '1',
          title: 'Dune Part Two',
          dueDate: new Date().toISOString(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          snoozeCount: 0,
          culturalMetadata: { mediaType: 'movie', platform: 'MAX' },
        },
        {
          id: '2',
          title: 'Shogun',
          dueDate: new Date().toISOString(),
          status: 'completed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          snoozeCount: 0,
          culturalMetadata: { mediaType: 'show', platform: 'Hulu' },
        },
        {
          id: '3',
          title: 'Buy groceries',
          dueDate: new Date().toISOString(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          snoozeCount: 0,
        },
      ];

      await notificationService.reconcileWeekendWatchlistNotification(reminders);

      expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            body: 'You have 1 unwatched title queued',
          }),
        })
      );
    });
  });

  describe('3. Watchlist Notification Tap Navigation Routing', () => {
    it('routes body tap directly into Watchlist tab via onOpenWatchlist', async () => {
      const onOpenWatchlist = jest.fn();
      const onOpenSnoozeModal = jest.fn();

      const HookConsumer = () => {
        useNotifications({ onOpenWatchlist, onOpenSnoozeModal, autoRequestPermissions: false });
        return null;
      };

      await act(async () => {
        ReactTestRenderer.create(<HookConsumer />);
      });

      // Simulate tapping the weekend watchlist notification
      await act(async () => {
        await mockNotifications.__triggerNotificationResponse({
          actionIdentifier: mockNotifications.DEFAULT_ACTION_IDENTIFIER,
          notification: {
            date: Date.now(),
            request: {
              identifier: 'watchlist_notif_1',
              content: {
                title: '🎬 Weekend Watchlist',
                body: 'You have 2 unwatched titles queued',
                categoryIdentifier: null,
                data: { screen: 'watchlist', type: 'watchlist', count: 2 },
              },
              trigger: null,
            },
          },
        });
      });

      expect(onOpenWatchlist).toHaveBeenCalledTimes(1);
      expect(onOpenSnoozeModal).not.toHaveBeenCalled();
    });

    it('routes cold boot notification response with screen: watchlist to onOpenWatchlist', async () => {
      const onOpenWatchlist = jest.fn();

      mockNotifications.getLastNotificationResponseAsync.mockResolvedValueOnce({
        actionIdentifier: mockNotifications.DEFAULT_ACTION_IDENTIFIER,
        notification: {
          date: Date.now(),
          request: {
            identifier: 'watchlist_cold_boot',
            content: {
              title: '🎬 Weekend Watchlist',
              body: 'You have 4 unwatched titles queued',
              categoryIdentifier: null,
              data: { screen: 'watchlist', type: 'watchlist', count: 4 },
            },
            trigger: null,
          },
        },
      });

      const HookConsumer = () => {
        useNotifications({ onOpenWatchlist, autoRequestPermissions: false });
        return null;
      };

      await act(async () => {
        ReactTestRenderer.create(<HookConsumer />);
      });

      expect(onOpenWatchlist).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. QuickCaptureBar Voice Ingress', () => {
    let originalSpeechRecognition: any;

    beforeEach(() => {
      originalSpeechRecognition = (window as any).SpeechRecognition;
    });

    afterEach(() => {
      (window as any).SpeechRecognition = originalSpeechRecognition;
    });

    it('shows microphone button and falls back gracefully when SpeechRecognition is not available', async () => {
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar onCreateReminder={jest.fn()} />
          </ThemeProvider>
        );
      });

      const micBtn = renderer.root.findByProps({ testID: 'quick-capture-mic-btn' });
      expect(micBtn).toBeDefined();

      await act(async () => {
        micBtn.props.onPress();
      });

      const banner = renderer.root.findByProps({ testID: 'voice-status-banner' });
      expect(banner).toBeDefined();
      expect(banner.props.children.props.children).toBe('VOICE INPUT UNAVAILABLE');

      await act(async () => {
        renderer.unmount();
      });
    });

    it('activates visual listening indicator and updates text on speech results', async () => {
      let instance: any = null;

      class MockSpeechRecognition {
        continuous = false;
        interimResults = true;
        lang = 'en-US';
        onstart: (() => void) | null = null;
        onresult: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        onend: (() => void) | null = null;

        constructor() {
          instance = this;
        }

        start() {
          if (this.onstart) this.onstart();
        }

        stop() {
          if (this.onend) this.onend();
        }

        abort() {
          if (this.onend) this.onend();
        }
      }

      (window as any).SpeechRecognition = MockSpeechRecognition;

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar onCreateReminder={jest.fn()} />
          </ThemeProvider>
        );
      });

      const micBtn = renderer.root.findByProps({ testID: 'quick-capture-mic-btn' });

      await act(async () => {
        micBtn.props.onPress();
      });

      expect(instance).not.toBeNull();

      // Visual listening banner should be active
      const banner = renderer.root.findByProps({ testID: 'voice-status-banner' });
      expect(banner).toBeDefined();
      expect(banner.props.children.props.children).toContain('LISTENING');

      // Simulate speech result
      await act(async () => {
        instance.onresult({
          results: [[{ transcript: 'buy coffee tomorrow morning' }]],
        });
      });

      const input = renderer.root.findByProps({ testID: 'quick-capture-input' });
      expect(input.props.value).toBe('buy coffee tomorrow morning');

      // Tapping mic button again stops listening
      await act(async () => {
        micBtn.props.onPress();
      });

      const bannerAfterStop = renderer.root.findAllByProps({ testID: 'voice-status-banner' });
      expect(bannerAfterStop).toHaveLength(0);

      await act(async () => {
        renderer.unmount();
      });
    });

    it('does NOT duplicate words across multiple interim/streaming speech results', async () => {
      let instance: any = null;

      class MockStreamingSpeechRecognition {
        continuous = false;
        interimResults = true;
        lang = 'en-US';
        onstart: (() => void) | null = null;
        onresult: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        onend: (() => void) | null = null;

        constructor() {
          instance = this;
        }

        start() {
          if (this.onstart) this.onstart();
        }

        stop() {
          if (this.onend) this.onend();
        }

        abort() {
          if (this.onend) this.onend();
        }
      }

      (window as any).SpeechRecognition = MockStreamingSpeechRecognition;

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar onCreateReminder={jest.fn()} />
          </ThemeProvider>
        );
      });

      const micBtn = renderer.root.findByProps({ testID: 'quick-capture-mic-btn' });

      await act(async () => {
        micBtn.props.onPress();
      });

      // Stream multiple interim results (simulating speech accumulation)
      await act(async () => {
        instance.onresult({
          results: [[{ transcript: 'buy' }]],
        });
      });
      let input = renderer.root.findByProps({ testID: 'quick-capture-input' });
      expect(input.props.value).toBe('buy');

      await act(async () => {
        instance.onresult({
          results: [[{ transcript: 'buy milk' }]],
        });
      });
      input = renderer.root.findByProps({ testID: 'quick-capture-input' });
      expect(input.props.value).toBe('buy milk');

      await act(async () => {
        instance.onresult({
          results: [[{ transcript: 'buy milk tomorrow' }]],
        });
      });
      input = renderer.root.findByProps({ testID: 'quick-capture-input' });
      expect(input.props.value).toBe('buy milk tomorrow');

      await act(async () => {
        renderer.unmount();
      });
    });

    it('displays single-draft preview and ADD button for single checklist items (not ADD 1 or SPLIT 1)', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar onCreateReminder={jest.fn()} />
          </ThemeProvider>
        );
      });

      const input = renderer.root.findByProps({ testID: 'quick-capture-input' });

      // Enter a single checkbox item with a time cue
      await act(async () => {
        input.props.onChangeText('- [ ] Buy oat milk tomorrow 9am');
      });

      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });
      expect(submitBtn.props.children.props.children).toBe('ADD');

      const preview = renderer.root.findByProps({ testID: 'capture-preview' });
      expect(preview.props.children).not.toContain('SPLIT 1 ITEMS');

      await act(async () => {
        renderer.unmount();
      });
    });
  });
});
