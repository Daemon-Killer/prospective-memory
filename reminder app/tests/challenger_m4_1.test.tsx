/**
 * Remy Reminders - Challenger M4-1 Empirical Verification Suite
 *
 * Adversarial empirical testing of Milestone 4 hardening:
 * 1. QuickCaptureBar useRef in-flight guard under extreme synchronous bursts (10x, 100x)
 * 2. QuickCaptureBar microtask interleaving and queueMicrotask bursts
 * 3. QuickCaptureBar cross-channel concurrent triggers (onPress + onSubmitEditing)
 * 4. QuickCaptureBar sequential unblocking and lifecycle integrity across multiple creations
 * 5. QuickCaptureBar resilience to asynchronous rejections, synchronous exceptions, and lock recovery
 * 6. QuickCaptureBar floating haptic promise rejection resilience
 * 7. QuickCaptureBar unmount safety during active in-flight execution
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemeProvider } from '../src/theme/ThemeContext';
import { QuickCaptureBar, PRESET_CHIPS } from '../src/components/QuickCaptureBar';
import { CapturePreset } from '../src/utils/captureCompiler';

describe('Challenger M4-1: QuickCaptureBar In-Flight Hardening & Concurrency Stress Suite', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  describe('Synchronous & Microtask Burst Protection', () => {
    it('synchronously blocks 10 rapid button taps within the exact same event loop tick', async () => {
      let invocationCount = 0;
      let activeExecutions = 0;
      let maxConcurrentExecutions = 0;

      const slowCreate = jest.fn(async () => {
        invocationCount++;
        activeExecutions++;
        maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeExecutions--;
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={slowCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('10x Burst Test');
      });

      // Fire 10 synchronous presses in immediate succession
      await act(async () => {
        const promises: Promise<void>[] = [];
        for (let i = 0; i < 10; i++) {
          promises.push(submitBtn.props.onPress());
        }
        await Promise.all(promises);
      });

      expect(invocationCount).toBe(1);
      expect(maxConcurrentExecutions).toBe(1);
      expect(slowCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('synchronously blocks 100 simultaneous calls via Promise.all', async () => {
      let callCount = 0;
      const delayedCreate = jest.fn(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 25));
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="dark">
            <QuickCaptureBar onCreateReminder={delayedCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('100x Hammer Test');
      });

      await act(async () => {
        const burst = Array.from({ length: 100 }, () => submitBtn.props.onPress());
        await Promise.all(burst);
      });

      expect(callCount).toBe(1);
      expect(delayedCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('blocks microtask-queued triggers before async execution resolves', async () => {
      const slowCreate = jest.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 40))
      );

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="void">
            <QuickCaptureBar onCreateReminder={slowCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Microtask burst test');
      });

      await act(async () => {
        // Trigger 1: synchronous
        const p1 = submitBtn.props.onPress();

        // Trigger 2: microtask queue
        const p2 = new Promise<void>((resolve) => {
          queueMicrotask(async () => {
            await submitBtn.props.onPress();
            resolve();
          });
        });

        // Trigger 3: promise resolution tick
        const p3 = Promise.resolve().then(() => submitBtn.props.onPress());

        await Promise.all([p1, p2, p3]);
      });

      expect(slowCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });

    it('blocks cross-channel bursts: submit button press + keyboard return key submitted in same tick', async () => {
      const slowCreate = jest.fn(
        () => new Promise<void>((resolve) => setTimeout(resolve, 30))
      );

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={slowCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Cross-channel burst test');
      });

      await act(async () => {
        // Both button tap AND keyboard submit event triggered concurrently
        const pBtn = submitBtn.props.onPress();
        const pKbd = inputElem.props.onSubmitEditing();
        await Promise.all([pBtn, pKbd]);
      });

      expect(slowCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('Sequential Unblocking & Lifecycle Liveness', () => {
    it('properly unlocks after each completion, enabling successive task creations', async () => {
      const createdItems: string[] = [];
      const createReminder = jest.fn(async (input: { title: string; dueDate: Date; preset?: CapturePreset }) => {
        createdItems.push(input.title);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={createReminder} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      const tasksToCreate = ['First Task', 'Second Task', 'Third Task', 'Fourth Task', 'Fifth Task'];

      for (const title of tasksToCreate) {
        act(() => {
          inputElem.props.onChangeText(title);
        });

        await act(async () => {
          await submitBtn.props.onPress();
        });

        // Verify input cleared and lock released
        expect(inputElem.props.value).toBe('');
      }

      expect(createdItems).toEqual(tasksToCreate);
      expect(createReminder).toHaveBeenCalledTimes(5);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('Adversarial Error Handling & Lock Recovery', () => {
    it('safely releases in-flight lock when onCreateReminder rejects asynchronously', async () => {
      let attempt = 0;
      const unstableCreate = jest.fn(async () => {
        attempt++;
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw new Error('Transient database error on attempt 1');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={unstableCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Resilient Task');
      });

      // Attempt 1: Rejection occurs; concurrent burst during attempt 1 is blocked
      await act(async () => {
        const p1 = submitBtn.props.onPress();
        const p2 = submitBtn.props.onPress();
        await expect(Promise.all([p1, p2])).rejects.toThrow('Transient database error on attempt 1');
      });

      // Handled 1 attempt
      expect(unstableCreate).toHaveBeenCalledTimes(1);
      // Text preserved so user does not lose input
      expect(inputElem.props.value).toBe('Resilient Task');

      // Attempt 2: Lock must have been cleanly released in finally block
      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(unstableCreate).toHaveBeenCalledTimes(2);
      // Now text is cleared on success
      expect(inputElem.props.value).toBe('');

      act(() => {
        renderer.unmount();
      });
    });

    it('safely releases in-flight lock when onCreateReminder throws synchronously', async () => {
      let callCount = 0;
      const syncThrowCreate = jest.fn(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Synchronous assertion fault');
        }
        return Promise.resolve();
      });

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={syncThrowCreate as any} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Sync throw test');
      });

      await act(async () => {
        await expect(submitBtn.props.onPress()).rejects.toThrow('Synchronous assertion fault');
      });

      expect(callCount).toBe(1);

      // Subsequent attempt succeeds without deadlock
      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(callCount).toBe(2);
      expect(inputElem.props.value).toBe('');

      act(() => {
        renderer.unmount();
      });
    });

    it('ignores empty, whitespace-only, or whitespace-tab-newline submissions without locking', async () => {
      const mockCreate = jest.fn();

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={mockCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      // Empty
      act(() => {
        inputElem.props.onChangeText('');
      });
      await act(async () => {
        await submitBtn.props.onPress();
      });

      // Whitespace
      act(() => {
        inputElem.props.onChangeText('   \t  \n  ');
      });
      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(mockCreate).not.toHaveBeenCalled();

      // Now enter valid text
      act(() => {
        inputElem.props.onChangeText('Valid intention');
      });
      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);

      act(() => {
        renderer.unmount();
      });
    });
  });

  describe('Haptic Exception Resilience & Floating Promise Absorption', () => {
    it('safely tolerates Haptics rejection on chip selection and submit without interrupting capture', async () => {
      const selectionSpy = jest
        .spyOn(Haptics, 'selectionAsync')
        .mockRejectedValue(new Error('Haptics actuator missing'));
      const impactSpy = jest
        .spyOn(Haptics, 'impactAsync')
        .mockRejectedValue(new Error('Haptics subsystem crash'));

      const mockCreate = jest.fn().mockResolvedValue(undefined);

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={mockCreate} />
          </ThemeProvider>
        );
      });

      // Select chip - triggers selectionAsync
      const chip1h = renderer.root.findByProps({ testID: 'chip-1h' });
      act(() => {
        chip1h.props.onPress();
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Haptics rejection test');
      });

      // Submit - triggers impactAsync
      await act(async () => {
        await submitBtn.props.onPress();
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Haptics rejection test',
          preset: '1h',
        })
      );
      expect(selectionSpy).toHaveBeenCalled();
      expect(impactSpy).toHaveBeenCalled();

      act(() => {
        renderer.unmount();
      });

      selectionSpy.mockRestore();
      impactSpy.mockRestore();
    });
  });

  describe('Component Unmount During In-Flight Execution', () => {
    it('does not throw unhandled exceptions if component unmounts while creation is awaiting', async () => {
      let resolvePromise: () => void = () => {};
      const hangingCreate = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePromise = resolve;
          })
      );

      let renderer: any = null;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialMode="light">
            <QuickCaptureBar onCreateReminder={hangingCreate} />
          </ThemeProvider>
        );
      });

      const inputElem = renderer.root.findByProps({ testID: 'quick-capture-input' });
      const submitBtn = renderer.root.findByProps({ testID: 'quick-capture-submit' });

      act(() => {
        inputElem.props.onChangeText('Unmount test task');
      });

      // Start submission
      let pressPromise: Promise<void> | null = null;
      act(() => {
        pressPromise = submitBtn.props.onPress();
      });

      expect(hangingCreate).toHaveBeenCalledTimes(1);

      // Unmount while in-flight
      act(() => {
        renderer.unmount();
      });

      // Now resolve the promise in the background
      await act(async () => {
        resolvePromise();
        await pressPromise;
      });

      // Should complete without error
      expect(hangingCreate).toHaveBeenCalledTimes(1);
    });
  });
});
