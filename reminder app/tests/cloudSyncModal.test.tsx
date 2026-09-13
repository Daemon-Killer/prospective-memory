import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ReactTestRenderer = require('react-test-renderer');
const { act } = ReactTestRenderer;
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CloudSyncModal } from '../src/components/CloudSyncModal';
import { cloudSyncService } from '../src/services/cloudSyncService';
import { lightColors } from '../src/theme/colors';

describe('CloudSyncModal Component', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('renders modal and triggers Force Full Resync on button press', async () => {
    const forceSpy = jest.spyOn(cloudSyncService, 'forceFullSync').mockResolvedValue({
      success: true,
      syncedCount: 5,
    });
    const syncSpy = jest.spyOn(cloudSyncService, 'syncNow').mockResolvedValue({
      success: true,
      syncedCount: 2,
    });

    let root: any;
    await act(async () => {
      root = ReactTestRenderer.create(
        <CloudSyncModal visible={true} onClose={jest.fn()} colors={lightColors} />
      );
    });

    const forceBtn = root.root.findByProps({ testID: 'force-resync-btn' });
    expect(forceBtn).toBeDefined();

    await act(async () => {
      forceBtn.props.onPress();
    });

    expect(forceSpy).toHaveBeenCalledTimes(1);

    const syncBtn = root.root.findByProps({ testID: 'sync-now-btn' });
    expect(syncBtn).toBeDefined();

    await act(async () => {
      syncBtn.props.onPress();
    });

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
