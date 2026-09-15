import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import {
  serializeStrokes,
  deserializeStrokes,
  pointsToSvgPath,
  DrawingCanvasModal,
  InkStroke,
} from '../src/components/DrawingCanvasModal';
import { QuickCaptureBar } from '../src/components/QuickCaptureBar';
import { ReminderCard } from '../src/components/ReminderCard';
import { storageService } from '../src/services/storageService';
import { Reminder } from '../src/types/reminder';
import { voidColors } from '../src/theme/colors';
import { ThemeProvider } from '../src/theme/ThemeContext';

describe('Lockscreen Quick-Capture & Stylus Ink Canvas Suite', () => {
  beforeEach(async () => {
    await storageService.init();
    await storageService.clear();
  });

  describe('1. Ink Serialization & Geometry Algorithms', () => {
    it('serializes and deserializes strokes with high fidelity', () => {
      const strokes: InkStroke[] = [
        {
          color: '#80CBC4',
          width: 4.5,
          points: [
            { x: 10.25, y: 20.48 },
            { x: 15.61, y: 25.12 },
            { x: 22.84, y: 30.95 },
          ],
        },
        {
          color: '#FFFFFF',
          width: 2.5,
          points: [
            { x: 50, y: 60 },
            { x: 70, y: 80 },
          ],
        },
      ];

      const serialized = serializeStrokes(strokes, 400, 300);
      expect(typeof serialized).toBe('string');
      expect(serialized).toContain('"v":1');
      expect(serialized).toContain('"w":400');
      expect(serialized).toContain('"h":300');

      const deserialized = deserializeStrokes(serialized);
      expect(deserialized.width).toBe(400);
      expect(deserialized.height).toBe(300);
      expect(deserialized.strokes.length).toBe(2);
      expect(deserialized.strokes[0].color).toBe('#80CBC4');
      expect(deserialized.strokes[0].width).toBe(4.5);
      expect(deserialized.strokes[0].points.length).toBe(3);
      expect(deserialized.strokes[0].points[0].x).toBe(10.3); // rounded to 1 decimal
      expect(deserialized.strokes[0].points[0].y).toBe(20.5);
    });

    it('handles malformed, empty, or corrupted stroke JSON gracefully', () => {
      expect(deserializeStrokes('').strokes).toEqual([]);
      expect(deserializeStrokes('not-json').strokes).toEqual([]);
      expect(deserializeStrokes('{"v":1}').strokes).toEqual([]);
      expect(deserializeStrokes('{"strokes":null}').strokes).toEqual([]);
    });

    it('converts point arrays to valid SVG Path strings', () => {
      expect(pointsToSvgPath([])).toBe('');
      expect(pointsToSvgPath([{ x: 10, y: 20 }])).toBe('M 10 20 l 0.1 0.1');
      expect(
        pointsToSvgPath([
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ])
      ).toBe('M 10 20 L 30 40 L 50 60');
    });
  });

  describe('2. DrawingCanvasModal Component', () => {
    it('renders modal with Swiss Void controls and title input', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <DrawingCanvasModal
            visible={true}
            onClose={jest.fn()}
            onSave={jest.fn()}
            themeColors={voidColors}
          />
        );
      });

      const modal = renderer!.root.findByProps({ testID: 'drawing-canvas-modal' });
      expect(modal.props.visible).toBe(true);

      const titleInput = renderer!.root.findByProps({ testID: 'canvas-title-input' });
      expect(titleInput).toBeDefined();

      // Palette buttons
      expect(renderer!.root.findByProps({ testID: 'color-btn-white' })).toBeDefined();
      expect(renderer!.root.findByProps({ testID: 'color-btn-cyan' })).toBeDefined();
      expect(renderer!.root.findByProps({ testID: 'color-btn-amber' })).toBeDefined();

      // Tool buttons
      expect(renderer!.root.findByProps({ testID: 'canvas-undo-btn' })).toBeDefined();
      expect(renderer!.root.findByProps({ testID: 'canvas-clear-btn' })).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
    });

    it('triggers onSave with serialized strokes when saving drawing', async () => {
      const handleSave = jest.fn();
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <DrawingCanvasModal
            visible={true}
            onClose={jest.fn()}
            onSave={handleSave}
            themeColors={voidColors}
          />
        );
      });

      const touchArea = renderer!.root.findByProps({ testID: 'canvas-touch-area' });
      const mockEvent = (x: number, y: number) => ({
        nativeEvent: { locationX: x, locationY: y },
        touchHistory: {
          mostRecentTimeStamp: 100,
          indexOfSingleActiveTouch: 0,
          numberActiveTouches: 1,
          touchBank: [
            {
              touchActive: true,
              startPageX: x,
              startPageY: y,
              startTimeStamp: 100,
              currentPageX: x,
              currentPageY: y,
              currentTimeStamp: 100,
              previousPageX: x,
              previousPageY: y,
              previousTimeStamp: 100,
            },
          ],
        },
      });

      // Simulate drawing gesture
      await act(async () => {
        touchArea.props.onStartShouldSetResponder();
        touchArea.props.onResponderGrant(mockEvent(20, 30));
        touchArea.props.onResponderMove(mockEvent(25, 35));
        touchArea.props.onResponderRelease(mockEvent(25, 35));
      });

      // Enter note title
      const titleInput = renderer!.root.findByProps({ testID: 'canvas-title-input' });
      await act(async () => {
        titleInput.props.onChangeText('Architectural Diagram');
      });

      // Save
      const saveBtn = renderer!.root.findByProps({ testID: 'canvas-save-btn' });
      await act(async () => {
        await saveBtn.props.onPress();
      });

      expect(handleSave).toHaveBeenCalledTimes(1);
      const payload = handleSave.mock.calls[0][0];
      expect(payload.title).toBe('Architectural Diagram');
      expect(payload.inkData).toBeDefined();
      expect(payload.inkData).toContain('"strokes"');

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  describe('3. QuickCaptureBar Ink Canvas Integration', () => {
    it('provides ink button which toggles DrawingCanvasModal', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <QuickCaptureBar
              onCreateReminder={jest.fn()}
              themeColors={voidColors}
            />
          </ThemeProvider>
        );
      });

      const inkBtn = renderer!.root.findByProps({ testID: 'quick-capture-ink-btn' });
      expect(inkBtn).toBeDefined();

      const modal = renderer!.root.findByProps({ testID: 'drawing-canvas-modal' });
      expect(modal.props.visible).toBe(false);

      // Tap ink button
      await act(async () => {
        inkBtn.props.onPress();
      });

      const modalOpen = renderer!.root.findByProps({ testID: 'drawing-canvas-modal' });
      expect(modalOpen.props.visible).toBe(true);

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  describe('4. ReminderCard with Attached Ink Preview & Fullscreen Viewer', () => {
    const sampleInk = serializeStrokes([
      {
        color: '#FFFFFF',
        width: 3,
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 50 },
        ],
      },
    ]);

    const reminderWithInk: Reminder = {
      id: 'rem-ink-1',
      title: 'Stylus Blueprint',
      notes: 'Check pins 3 & 4',
      dueDate: new Date(Date.now() + 3600000).toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      armed: true,
      inkData: sampleInk,
    };

    it('renders ink preview container on reminder card when inkData is present', async () => {
      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ReminderCard
              reminder={reminderWithInk}
              themeColors={voidColors}
              onToggleComplete={jest.fn()}
              onSnoozePress={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      const previewBtn = renderer!.root.findByProps({ testID: 'reminder-ink-preview-rem-ink-1' });
      expect(previewBtn).toBeDefined();

      // Initial state: viewer modal closed
      const viewerModal = renderer!.root.findByProps({ testID: 'reminder-ink-viewer-rem-ink-1' });
      expect(viewerModal.props.visible).toBe(false);

      // Tap preview thumbnail to view full screen
      await act(async () => {
        previewBtn.props.onPress();
      });

      const viewerModalOpen = renderer!.root.findByProps({ testID: 'reminder-ink-viewer-rem-ink-1' });
      expect(viewerModalOpen.props.visible).toBe(true);

      // Close modal
      const closeBtn = renderer!.root.findByProps({ testID: 'reminder-ink-close-rem-ink-1' });
      await act(async () => {
        closeBtn.props.onPress();
      });

      const viewerModalClosed = renderer!.root.findByProps({ testID: 'reminder-ink-viewer-rem-ink-1' });
      expect(viewerModalClosed.props.visible).toBe(false);

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  describe('5. StorageService Ink Persistence & Lockscreen Ingress ID Preservation', () => {
    it('persists and updates inkData on reminders through StorageService', async () => {
      const sampleInk = '{"v":1,"w":320,"h":240,"strokes":[{"c":"#FFFFFF","w":3,"pts":[[5,5],[10,10]]}]}';

      const created = await storageService.create({
        title: 'Ink Reminder 1',
        dueDate: new Date(Date.now() + 60000).toISOString(),
        inkData: sampleInk,
      });

      expect(created.inkData).toBe(sampleInk);

      const fetched = storageService.getById(created.id);
      expect(fetched?.inkData).toBe(sampleInk);

      // Update inkData
      const updatedInk = '{"v":1,"w":320,"h":240,"strokes":[]}';
      const updated = await storageService.update(created.id, {
        inkData: updatedInk,
      });
      expect(updated.inkData).toBe(updatedInk);

      // Remote sync preserves inkData
      await storageService.applyRemoteSync([
        {
          id: 'remote-ink-1',
          title: 'Remote Ink',
          dueDate: new Date(Date.now() + 120000).toISOString(),
          status: 'pending',
          snoozeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          inkData: sampleInk,
        },
      ]);

      const remoteFetched = storageService.getById('remote-ink-1');
      expect(remoteFetched?.inkData).toBe(sampleInk);
    });

    it('preserves pre-assigned ID on creation to prevent cloud sync duplication from lockscreen captures', async () => {
      const lockscreenId = 'e3b0c442-98fc-4c14-9afe-23abdc390977';
      const created = await storageService.create({
        id: lockscreenId,
        title: 'Lockscreen Thought',
        dueDate: new Date(Date.now() + 300000).toISOString(),
        armed: true,
      });

      expect(created.id).toBe(lockscreenId);
      expect(storageService.getById(lockscreenId)).toBeDefined();

      // Subsequent create with same ID returns existing without duplicating
      const existing = await storageService.create({
        id: lockscreenId,
        title: 'Duplicate Attempt',
        dueDate: new Date(Date.now() + 300000).toISOString(),
      });
      expect(existing.id).toBe(lockscreenId);
      expect(existing.title).toBe('Lockscreen Thought');
      expect(storageService.getAll().filter((r) => r.id === lockscreenId).length).toBe(1);
    });

    it('renders single-point dot taps in native stroke rendering', async () => {
      const dotInk = serializeStrokes([
        {
          color: '#80CBC4',
          width: 5,
          points: [{ x: 50, y: 50 }],
        },
      ]);

      const reminderWithDot: Reminder = {
        id: 'rem-dot-1',
        title: 'Stipple Note',
        dueDate: new Date(Date.now() + 60000).toISOString(),
        status: 'pending',
        snoozeCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        armed: true,
        inkData: dotInk,
      };

      let renderer: any;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider>
            <ReminderCard
              reminder={reminderWithDot}
              themeColors={voidColors}
              onToggleComplete={jest.fn()}
              onSnoozePress={jest.fn()}
            />
          </ThemeProvider>
        );
      });

      // Open viewer modal
      const previewBtn = renderer!.root.findByProps({ testID: 'reminder-ink-preview-rem-dot-1' });
      await act(async () => {
        previewBtn.props.onPress();
      });

      const dotElement = renderer!.root.findByProps({ testID: 'reminder-ink-viewer-rem-dot-1' });
      expect(dotElement).toBeDefined();

      await act(async () => {
        renderer.unmount();
      });
    });
  });
});
