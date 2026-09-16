/**
 * Remy Reminders - Floating '+' Bubble Overlay Test Suite
 * Verification for Option 2: Floating '+' Bubble Overlay
 */

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;

import { BubbleSettingsModal } from '../src/components/BubbleSettingsModal';
import { remyCaptureService } from '../src/services/remyCaptureService';
import { darkColors } from '../src/theme/colors';

// Mock remyCaptureService
jest.mock('../src/services/remyCaptureService', () => ({
  remyCaptureService: {
    canDrawOverlays: jest.fn(),
    isBubbleRunning: jest.fn(),
    requestOverlayPermission: jest.fn(),
    startBubble: jest.fn(),
    stopBubble: jest.fn(),
  },
}));

describe('Option 2: Floating Bubble Overlay Suite', () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    themeColors: darkColors,
  };

  let currentRenderer: any = null;

  beforeEach(() => {
    jest.clearAllMocks();
    (remyCaptureService.canDrawOverlays as jest.Mock).mockResolvedValue(false);
    (remyCaptureService.isBubbleRunning as jest.Mock).mockResolvedValue(false);
    (remyCaptureService.requestOverlayPermission as jest.Mock).mockResolvedValue(true);
    (remyCaptureService.startBubble as jest.Mock).mockResolvedValue(true);
    (remyCaptureService.stopBubble as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    if (currentRenderer) {
      act(() => {
        currentRenderer.unmount();
      });
      currentRenderer = null;
    }
  });

  it('renders correctly with required status when permission is not yet granted', async () => {
    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    expect(root.findByProps({ testID: 'bubble-settings-modal' })).toBeTruthy();
    expect(root.findByProps({ testID: 'bubble-settings-close-btn' })).toBeTruthy();

    const permStatus = root.findByProps({ testID: 'bubble-permission-status' });
    expect(permStatus.props.children).toBe('REQUIRED');

    const runningStatus = root.findByProps({ testID: 'bubble-running-status' });
    expect(runningStatus.props.children).toBe('INACTIVE');

    expect(root.findByProps({ testID: 'bubble-request-perm-btn' })).toBeTruthy();
  });

  it('requests permission when grant button is clicked and updates status', async () => {
    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    const requestBtn = root.findByProps({ testID: 'bubble-request-perm-btn' });

    await act(async () => {
      await requestBtn.props.onPress();
    });

    expect(remyCaptureService.requestOverlayPermission).toHaveBeenCalledTimes(1);

    const permStatus = root.findByProps({ testID: 'bubble-permission-status' });
    expect(permStatus.props.children).toBe('GRANTED');
  });

  it('allows starting the floating bubble when permission is granted', async () => {
    (remyCaptureService.canDrawOverlays as jest.Mock).mockResolvedValue(true);
    (remyCaptureService.isBubbleRunning as jest.Mock).mockResolvedValue(false);

    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    const permStatus = root.findByProps({ testID: 'bubble-permission-status' });
    expect(permStatus.props.children).toBe('GRANTED');

    const toggleBtn = root.findByProps({ testID: 'bubble-toggle-service-btn' });

    await act(async () => {
      await toggleBtn.props.onPress();
    });

    expect(remyCaptureService.startBubble).toHaveBeenCalledTimes(1);
    const runningStatus = root.findByProps({ testID: 'bubble-running-status' });
    expect(runningStatus.props.children).toBe('ACTIVE');
  });

  it('allows stopping the floating bubble when it is currently running', async () => {
    (remyCaptureService.canDrawOverlays as jest.Mock).mockResolvedValue(true);
    (remyCaptureService.isBubbleRunning as jest.Mock).mockResolvedValue(true);

    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    const runningStatus = root.findByProps({ testID: 'bubble-running-status' });
    expect(runningStatus.props.children).toBe('ACTIVE');

    const toggleBtn = root.findByProps({ testID: 'bubble-toggle-service-btn' });

    await act(async () => {
      await toggleBtn.props.onPress();
    });

    expect(remyCaptureService.stopBubble).toHaveBeenCalledTimes(1);
    expect(runningStatus.props.children).toBe('INACTIVE');
  });

  it('refreshes status when refresh button is tapped', async () => {
    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    const refreshBtn = root.findByProps({ testID: 'bubble-refresh-btn' });

    await act(async () => {
      await refreshBtn.props.onPress();
    });

    // Initial check (1) + refresh button (1) = 2
    expect(remyCaptureService.canDrawOverlays).toHaveBeenCalledTimes(2);
    expect(remyCaptureService.isBubbleRunning).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when close button is clicked', async () => {
    let renderer: any;
    await act(async () => {
      currentRenderer = ReactTestRenderer.create(<BubbleSettingsModal {...defaultProps} />);
    });

    const root = currentRenderer.root;
    const closeBtn = root.findByProps({ testID: 'bubble-settings-close-btn' });

    act(() => {
      closeBtn.props.onPress();
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
