import React, { useState, useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme';
import { HomeScreen } from './src/screens/HomeScreen';
import { cloudSyncService } from './src/services/cloudSyncService';

export default function App() {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await cloudSyncService.syncNow();
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <HomeScreen onRefresh={handleRefresh} isRefreshing={refreshing} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

