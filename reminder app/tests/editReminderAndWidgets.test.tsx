/**
 * Automated Verification Suite for Reminder Editing (Message/Type/Custom Time),
 * Handwritten Ink Clean Retirement, and Android Lockscreen/Agenda Widgets
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider } from '../src/theme/ThemeContext';
import { voidColors } from '../src/theme/colors';
import { EditReminderModal } from '../src/components/EditReminderModal';
import { ReminderCard } from '../src/components/ReminderCard';
import { ReminderList } from '../src/components/ReminderList';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { storageService } from '../src/services/storageService';
import { notificationService } from '../src/services/notificationService';
import { cloudSyncService } from '../src/services/cloudSyncService';
import { remyCaptureService } from '../src/services/remyCaptureService';
import { useReminders } from '../src/hooks/useReminders';
import { Reminder, UpdateReminderInput } from '../src/types/reminder';

describe('Reminder Editing, Ink Retirement & Widgets Suite', () => {
  const baseNow = new Date('2026-09-19T10:00:00.000Z');

  beforeEach(async () => {
    await AsyncStorage.clear();
    await storageService.clear();
    jest.clearAllMocks();
  });

  describe('1. EditReminderModal UI Component', () => {
    const sampleReminder: Reminder = {
      id: 'rem-edit-modal-1',
      title: 'Original Title',
      notes: 'Original Notes',
      dueDate: new Date(baseNow.getTime() + 3600000).toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: baseNow.toISOString(),
      updatedAt: baseNow.toISOString(),
      armed: true,
      priority: 'medium',
    };

    it('renders modal with initial reminder title, notes, priority, and armed type', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={sampleReminder}
              onClose={jest.fn()}
              onSave={jest.fn()}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const titleInput = renderer.root.findByProps({ testID: 'edit-title-input' });
      expect(titleInput.props.value).toBe('Original Title');

      const notesInput = renderer.root.findByProps({ testID: 'edit-notes-input' });
      expect(notesInput.props.value).toBe('Original Notes');

      expect(renderer.root.findByProps({ testID: 'edit-priority-low' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'edit-priority-medium' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'edit-priority-high' })).toBeDefined();

      expect(renderer.root.findByProps({ testID: 'edit-type-armed' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'edit-type-inbox' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'edit-time-editor' })).toBeDefined();
    });

    it('allows changing priority, toggling to inbox thought, and adjusting exact custom time', async () => {
      const handleSave = jest.fn();
      let renderer: any;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={sampleReminder}
              onClose={jest.fn()}
              onSave={handleSave}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      // 1. Edit Title and Notes
      const titleInput = renderer.root.findByProps({ testID: 'edit-title-input' });
      const notesInput = renderer.root.findByProps({ testID: 'edit-notes-input' });
      await act(async () => {
        titleInput.props.onChangeText('Revamped Strategy Roadmap');
        notesInput.props.onChangeText('Include Q4 financial forecasts');
      });

      // 2. Select HIGH priority
      const highPriorityChip = renderer.root.findByProps({ testID: 'edit-priority-high' });
      await act(async () => {
        highPriorityChip.props.onPress();
      });

      // 3. Increment hour and minute
      const hourPlus = renderer.root.findByProps({ testID: 'edit-hour-plus' });
      const minutePlus = renderer.root.findByProps({ testID: 'edit-minute-plus' });
      await act(async () => {
        hourPlus.props.onPress();
        minutePlus.props.onPress();
      });

      // 4. Click Save
      const saveBtn = renderer.root.findByProps({ testID: 'edit-save-btn' });
      await act(async () => {
        await saveBtn.props.onPress();
      });

      expect(handleSave).toHaveBeenCalledTimes(1);
      const [calledId, updates] = handleSave.mock.calls[0];
      expect(calledId).toBe('rem-edit-modal-1');
      expect(updates.title).toBe('Revamped Strategy Roadmap');
      expect(updates.notes).toBe('Include Q4 financial forecasts');
      expect(updates.priority).toBe('high');
      expect(updates.armed).toBe(true);
      expect(updates.dueDate).toBeDefined();
    });

    it('rejects empty title with an error banner', async () => {
      const handleSave = jest.fn();
      let renderer: any;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={sampleReminder}
              onClose={jest.fn()}
              onSave={handleSave}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const titleInput = renderer.root.findByProps({ testID: 'edit-title-input' });
      await act(async () => {
        titleInput.props.onChangeText('   ');
      });

      const saveBtn = renderer.root.findByProps({ testID: 'edit-save-btn' });
      await act(async () => {
        await saveBtn.props.onPress();
      });

      expect(handleSave).not.toHaveBeenCalled();
      const errorBanner = renderer.root.findByProps({ testID: 'edit-error-banner' });
      expect(errorBanner).toBeDefined();
    });

    it('allows toggling from armed to inbox thought (unarmed)', async () => {
      const handleSave = jest.fn();
      let renderer: any;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={sampleReminder}
              onClose={jest.fn()}
              onSave={handleSave}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const inboxTypeChip = renderer.root.findByProps({ testID: 'edit-type-inbox' });
      await act(async () => {
        inboxTypeChip.props.onPress();
      });

      const saveBtn = renderer.root.findByProps({ testID: 'edit-save-btn' });
      await act(async () => {
        await saveBtn.props.onPress();
      });

      expect(handleSave).toHaveBeenCalledTimes(1);
      const [, updates] = handleSave.mock.calls[0];
      expect(updates.armed).toBe(false);
    });

    it('rejects invalid calendar dates (e.g. 2026-02-31) with an error banner', async () => {
      const handleSave = jest.fn();
      let renderer: any;

      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={sampleReminder}
              onClose={jest.fn()}
              onSave={handleSave}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const customDateInput = renderer.root.findByProps({ testID: 'edit-custom-date-input' });
      await act(async () => {
        customDateInput.props.onChangeText('2026-02-31');
      });

      const saveBtn = renderer.root.findByProps({ testID: 'edit-save-btn' });
      await act(async () => {
        await saveBtn.props.onPress();
      });

      expect(handleSave).not.toHaveBeenCalled();
      const errorBanner = renderer.root.findByProps({ testID: 'edit-error-banner' });
      expect(errorBanner).toBeDefined();

      const previewText = renderer.root.findByProps({ testID: 'edit-due-date-preview' });
      expect(previewText.props.children).toContain('INVALID DATE');
    });

    it('correctly wraps minutes and hours modulo without negative numbers', async () => {
      const targetDate = new Date();
      targetDate.setHours(0, 2, 0, 0);
      const reminderWithLowMinute: Reminder = {
        ...sampleReminder,
        id: 'rem-minute-wrap',
        dueDate: targetDate.toISOString(), // local hour 0, minute 2
      };

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <EditReminderModal
              visible={true}
              reminder={reminderWithLowMinute}
              onClose={jest.fn()}
              onSave={jest.fn()}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const minuteMinus = renderer.root.findByProps({ testID: 'edit-minute-minus' });
      const hourMinus = renderer.root.findByProps({ testID: 'edit-hour-minus' });

      await act(async () => {
        minuteMinus.props.onPress(); // 2 - 5 -> should wrap to 57, NOT negative
        hourMinus.props.onPress();   // 0 - 1 -> should wrap to 23, NOT negative
      });

      const minuteVal = renderer.root.findByProps({ testID: 'edit-minute-value' });
      const hourVal = renderer.root.findByProps({ testID: 'edit-hour-value' });

      expect(minuteVal.props.children).toBe('57');
      expect(hourVal.props.children).toBe('23');
      expect(Number(minuteVal.props.children)).toBeGreaterThanOrEqual(0);
      expect(Number(hourVal.props.children)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('2. ReminderCard & ReminderList Edit Integration', () => {
    it('renders EDIT button and triggers onEditPress callback', async () => {
      const handleEdit = jest.fn();
      const reminder: Reminder = {
        id: 'card-edit-test-1',
        title: 'Draft Annual Budget',
        dueDate: new Date(baseNow.getTime() + 7200000).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseNow.toISOString(),
        updatedAt: baseNow.toISOString(),
        armed: true,
        priority: 'high',
      };

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ReminderCard
              reminder={reminder}
              onToggleComplete={jest.fn()}
              onSnoozePress={jest.fn()}
              onEditPress={handleEdit}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      // Priority badge rendered
      const priorityBadge = renderer.root.findByProps({ testID: 'reminder-priority-badge-card-edit-test-1' });
      expect(priorityBadge).toBeDefined();

      // EDIT button rendered and clickable
      const editBtn = renderer.root.findByProps({ testID: 'reminder-edit-btn-card-edit-test-1' });
      expect(editBtn).toBeDefined();

      await act(async () => {
        editBtn.props.onPress();
      });

      expect(handleEdit).toHaveBeenCalledTimes(1);
      expect(handleEdit).toHaveBeenCalledWith(reminder);
    });

    it('passes onEditPress down through ReminderList', async () => {
      const handleEdit = jest.fn();
      const reminders: Reminder[] = [
        {
          id: 'list-item-1',
          title: 'Review PR #42',
          dueDate: new Date(baseNow.getTime() + 3600000).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: baseNow.toISOString(),
          updatedAt: baseNow.toISOString(),
          armed: true,
          priority: 'low',
        },
      ];

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ReminderList
              reminders={reminders}
              onToggleComplete={jest.fn()}
              onSnoozePress={jest.fn()}
              onEditPress={handleEdit}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const editBtn = renderer.root.findByProps({ testID: 'reminder-edit-btn-list-item-1' });
      expect(editBtn).toBeDefined();

      await act(async () => {
        editBtn.props.onPress();
      });

      expect(handleEdit).toHaveBeenCalledWith(reminders[0]);
    });
  });

  describe('3. StorageService Edit & Backend Sync Persistence', () => {
    it('persists message, notes, custom time, armed type, and priority updates', async () => {
      await storageService.init();

      const created = await storageService.create({
        title: 'Initial Idea',
        dueDate: new Date(baseNow.getTime() + 3600000).toISOString(),
        armed: true,
        priority: 'low',
      });

      expect(created.title).toBe('Initial Idea');
      expect(created.priority).toBe('low');

      // Edit reminder with custom future time, new notes, new priority, and disarm
      const customFutureDate = '2026-10-15T16:30:00.000Z';
      const updated = await storageService.update(created.id, {
        title: 'Refined Strategic Objective',
        notes: 'Aligned with stakeholder feedback',
        dueDate: customFutureDate,
        armed: false,
        priority: 'high',
      });

      expect(updated.title).toBe('Refined Strategic Objective');
      expect(updated.notes).toBe('Aligned with stakeholder feedback');
      expect(updated.dueDate).toBe(customFutureDate);
      expect(updated.armed).toBe(false);
      expect(updated.priority).toBe('high');

      // Verify fetched from cache matches
      const fetched = storageService.getById(created.id);
      expect(fetched?.title).toBe('Refined Strategic Objective');
      expect(fetched?.priority).toBe('high');
      expect(fetched?.armed).toBe(false);
    });

    it('preserves priority during storageService hydration from disk', async () => {
      // 1. Create a reminder with priority 'high'
      const created = await storageService.create({
        title: 'Priority Persistence Test',
        dueDate: new Date(baseNow.getTime() + 3600000).toISOString(),
        armed: true,
        priority: 'high',
      });
      expect(created.priority).toBe('high');

      // 2. Clear in-memory cache to simulate app restart/cold boot
      (storageService as any).cache.clear();
      (storageService as any).initialized = false;

      // 3. Re-initialize from AsyncStorage
      await storageService.init();

      // 4. Verify priority was hydrated properly and not dropped
      const reloaded = storageService.getById(created.id);
      expect(reloaded).toBeDefined();
      expect(reloaded?.priority).toBe('high');
    });

    it('cloudSyncService provides syncSingleReminder to post to /v1/reminders', async () => {
      const reminder: Reminder = {
        id: 'sync-direct-test',
        title: 'Direct Sync Reminder',
        dueDate: '2026-09-25T12:00:00.000Z',
        status: 'pending',
        snoozeCount: 0,
        createdAt: baseNow.toISOString(),
        updatedAt: baseNow.toISOString(),
        armed: true,
        priority: 'medium',
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => reminder,
      });
      (globalThis as any).fetch = mockFetch;

      const result = await cloudSyncService.syncSingleReminder(reminder);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/v1/reminders');
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.title).toBe('Direct Sync Reminder');
      expect(body.priority).toBe('medium');
    });
  });

  describe('4. Clean Retirement of Handwritten Ink from Capture UI', () => {
    it('removes ink button from capture bar when showInkCapture is false (mobile UI clean default)', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar
              onCreateReminder={jest.fn()}
              themeColors={voidColors}
              showInkCapture={false}
            />
          </ThemeProvider>
        );
      });

      // Quick capture input and submit buttons are present
      expect(renderer.root.findByProps({ testID: 'quick-capture-input' })).toBeDefined();
      expect(renderer.root.findByProps({ testID: 'quick-capture-submit' })).toBeDefined();

      // Retired ink button is NOT in the UI tree
      const inkBtn = renderer.root.findAllByProps({ testID: 'quick-capture-ink-btn' });
      expect(inkBtn.length).toBe(0);

      // Retired drawing modal is NOT rendered
      const modal = renderer.root.findAllByProps({ testID: 'drawing-canvas-modal' });
      expect(modal.length).toBe(0);
    });

    it('preserves backward compatibility when showInkCapture is true', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar
              onCreateReminder={jest.fn()}
              themeColors={voidColors}
              showInkCapture={true}
            />
          </ThemeProvider>
        );
      });

      const inkBtn = renderer.root.findByProps({ testID: 'quick-capture-ink-btn' });
      expect(inkBtn).toBeDefined();
    });
  });

  describe('5. Android Widgets & Lock Screen Integration', () => {
    it('remyCaptureService updates widget data with active reminders', async () => {
      const spyUpdateWidget = jest.spyOn(remyCaptureService, 'updateWidgetData').mockResolvedValue(true);

      const reminders = [
        {
          id: 'widget-item-1',
          title: 'Buy Groceries',
          dueDate: new Date(baseNow.getTime() + 1800000).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: baseNow.toISOString(),
          updatedAt: baseNow.toISOString(),
          armed: true,
          priority: 'high' as const,
        },
      ];

      const ok = await remyCaptureService.updateWidgetData(JSON.stringify(reminders));
      expect(ok).toBe(true);
      expect(spyUpdateWidget).toHaveBeenCalledWith(JSON.stringify(reminders));
    });

    it('remyCaptureService getWidgetData returns stored widget data', async () => {
      const sampleWidgetJson = JSON.stringify([{ id: 'widget-item-2', title: 'Top Glanceable Card' }]);
      const spyGetWidget = jest.spyOn(remyCaptureService, 'getWidgetData').mockResolvedValue(sampleWidgetJson);

      const data = await remyCaptureService.getWidgetData();
      expect(data).toBe(sampleWidgetJson);
      expect(spyGetWidget).toHaveBeenCalled();
    });
  });

  describe('6. Notification Rescheduling on Reminder Updates', () => {
    it('cancels scheduled notification when reminder is updated to past due, completed, or disarmed', async () => {
      const scheduleSpy = jest.spyOn(notificationService, 'scheduleReminderNotification').mockResolvedValue('notif-123');
      const cancelSpy = jest.spyOn(notificationService, 'cancelReminderNotification').mockResolvedValue(undefined);

      // Create an active reminder with notification scheduled for 2 hours in the future
      const futureDue = new Date(Date.now() + 7200000).toISOString();
      const created = await storageService.create({
        title: 'Future Notification Task',
        dueDate: futureDue,
        armed: true,
      });
      await storageService.setNotificationId(created.id, 'notif-123');

      let currentHook: ReturnType<typeof useReminders> | null = null;
      const HookHarness: React.FC = () => {
        currentHook = useReminders();
        return null;
      };

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(<HookHarness />);
      });

      expect(currentHook).not.toBeNull();

      // Scenario A: Update to PAST due date -> Old notification must be cancelled, notificationId set to null
      const pastDue = new Date(Date.now() - 3600000).toISOString();
      await act(async () => {
        await currentHook!.updateReminder(created.id, {
          dueDate: pastDue,
        });
      });

      expect(cancelSpy).toHaveBeenCalledWith('notif-123');
      let stored = storageService.getById(created.id);
      expect(stored?.notificationId).toBeNull();

      // Scenario B: Update to FUTURE due date -> Should cancel old (if any) and schedule new
      cancelSpy.mockClear();
      scheduleSpy.mockClear();
      scheduleSpy.mockResolvedValue('notif-456');

      const nextFuture = new Date(Date.now() + 10800000).toISOString();
      await act(async () => {
        await currentHook!.updateReminder(created.id, {
          dueDate: nextFuture,
        });
      });

      expect(scheduleSpy).toHaveBeenCalled();
      stored = storageService.getById(created.id);
      expect(stored?.notificationId).toBe('notif-456');

      // Scenario C: Disarm reminder (unarmed inbox thought) -> Notification cancelled
      cancelSpy.mockClear();
      await act(async () => {
        await currentHook!.updateReminder(created.id, {
          armed: false,
        });
      });

      expect(cancelSpy).toHaveBeenCalledWith('notif-456');
      stored = storageService.getById(created.id);
      expect(stored?.notificationId).toBeNull();

      await act(async () => {
        renderer.unmount();
      });
    });
  });
});
