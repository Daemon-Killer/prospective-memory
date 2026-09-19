import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, View, AppState, Modal, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useTheme } from '../theme/ThemeContext';
import { useReminders } from '../hooks/useReminders';
import { useNotifications } from '../hooks/useNotifications';
import { remyCaptureService } from '../services/remyCaptureService';
import { cloudSyncService } from '../services/cloudSyncService';
import { storageService } from '../services/storageService';
import { sensoryStorageService } from '../sensory/sensoryStorageService';
import { dealsStorageService } from '../sensory/dealsStorageService';
import { sensoryBridge } from '../sensory/sensoryBridge';
import { intentClassifier } from '../sensory/intentClassifier';
import { SensorySuggestion, VoucherItem } from '../sensory/types';
import { Masthead } from '../components/Masthead';
import { SensoryInboxShelf } from '../components/SensoryInboxShelf';
import { DealsRadarScreen } from './DealsRadarScreen';
import { WatchlistScreen } from './WatchlistScreen';
import { ReminderList } from '../components/ReminderList';
import { QuickCaptureBar } from '../components/QuickCaptureBar';
import { SnoozeModal } from '../components/SnoozeModal';
import { EditReminderModal } from '../components/EditReminderModal';
import { BubbleSettingsModal } from '../components/BubbleSettingsModal';
import { Reminder, SnoozePreset, CulturalMetadata, UpdateReminderInput } from '../types/reminder';
import { CapturePreset, compileMultiLineCapture, getStoredLingo } from '../utils/captureCompiler';
import { getWeekendWatchlistCue } from '../utils/watchlistParser';

export interface HomeScreenProps {
  reminders?: Reminder[];
  onCreateReminder?: (input: {
    id?: string;
    title: string;
    dueDate: Date;
    preset?: CapturePreset;
    armed?: boolean;
    inkData?: string | null;
    culturalMetadata?: CulturalMetadata | null;
  }) => Promise<void> | void;
  onToggleComplete?: (id: string) => Promise<void> | void;
  onSnoozeReminder?: (reminder: Reminder) => void;
  onDeleteReminder?: (id: string) => Promise<void> | void;
  onUpdateReminder?: (id: string, updates: UpdateReminderInput) => Promise<Reminder | void> | void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
  suggestions?: SensorySuggestion[];
  onAcceptSuggestion?: (id: string) => Promise<void> | void;
  onDismissSuggestion?: (id: string) => Promise<void> | void;
  vouchers?: VoucherItem[];
  onOpenDealsRadar?: () => void;
  onOpenWatchlist?: () => void;
  onOpenBubbleSettings?: () => void;
  autoClearPromos?: boolean;
  onToggleAutoClearPromos?: (enabled: boolean) => void;
  autoSnoozeNoise?: boolean;
  onToggleAutoSnoozeNoise?: (enabled: boolean) => void;
  currentTime?: Date;
  testID?: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  reminders: propReminders,
  onCreateReminder: propOnCreate,
  onToggleComplete: propOnToggleComplete,
  onSnoozeReminder: propOnSnooze,
  onDeleteReminder: propOnDelete,
  onUpdateReminder: propOnUpdateReminder,
  onRefresh: propOnRefresh,
  isRefreshing: propIsRefreshing,
  suggestions: propSuggestions,
  onAcceptSuggestion: propOnAcceptSuggestion,
  onDismissSuggestion: propOnDismissSuggestion,
  vouchers: propVouchers,
  onOpenDealsRadar: propOnOpenDealsRadar,
  onOpenWatchlist: propOnOpenWatchlist,
  onOpenBubbleSettings: propOnOpenBubbleSettings,
  autoClearPromos: propAutoClearPromos,
  onToggleAutoClearPromos: propOnToggleAutoClearPromos,
  autoSnoozeNoise: propAutoSnoozeNoise,
  onToggleAutoSnoozeNoise: propOnToggleAutoSnoozeNoise,
  currentTime = new Date(),
  testID = 'home-screen',
}) => {
  const { colors, mode, cycleTheme } = useTheme();
  const remindersHook = useReminders();

  const [selectedReminderForSnooze, setSelectedReminderForSnooze] = useState<Reminder | null>(null);
  const [snoozeModalVisible, setSnoozeModalVisible] = useState<boolean>(false);
  const [dealsRadarVisible, setDealsRadarVisible] = useState<boolean>(false);
  const [watchlistVisible, setWatchlistVisible] = useState<boolean>(false);
  const [bubbleSettingsVisible, setBubbleSettingsVisible] = useState<boolean>(false);
  const [isBubbleActive, setIsBubbleActive] = useState<boolean>(false);

  const [internalAutoClearPromos, setInternalAutoClearPromos] = useState<boolean>(true);
  const [internalAutoSnoozeNoise, setInternalAutoSnoozeNoise] = useState<boolean>(false);

  const autoClearPromos = propAutoClearPromos ?? internalAutoClearPromos;
  const autoSnoozeNoise = propAutoSnoozeNoise ?? internalAutoSnoozeNoise;

  const [internalSuggestions, setInternalSuggestions] = useState<SensorySuggestion[]>(() =>
    sensoryStorageService.getPendingSuggestions()
  );
  const [internalVouchers, setInternalVouchers] = useState<VoucherItem[]>(() =>
    dealsStorageService.getVouchers()
  );

  const suggestions = propSuggestions ?? internalSuggestions;
  const vouchers = propVouchers ?? internalVouchers;

  // Check bubble running state on mount
  useEffect(() => {
    let isMounted = true;
    remyCaptureService.isBubbleRunning().then((active) => {
      if (isMounted) setIsBubbleActive(active);
    }).catch(() => {});
    return () => { isMounted = false; };
  }, []);

  // Initialize and subscribe to sensory and deals storage
  useEffect(() => {
    let isMounted = true;
    sensoryStorageService.init().then(() => {
      if (isMounted) {
        setInternalSuggestions(sensoryStorageService.getPendingSuggestions());
      }
    });
    dealsStorageService.init().then(() => {
      if (isMounted) {
        setInternalVouchers(dealsStorageService.getVouchers());
      }
    });

    // Fetch persistent tray preferences
    sensoryBridge.getFilterConfig().then((cfg) => {
      if (isMounted && cfg) {
        if (cfg.autoClearPromos !== undefined) {
          setInternalAutoClearPromos(cfg.autoClearPromos);
        }
        if (cfg.autoSnoozeNoise !== undefined) {
          setInternalAutoSnoozeNoise(cfg.autoSnoozeNoise);
        }
      }
    }).catch(() => {});

    const unsubSensory = sensoryStorageService.subscribe(() => {
      if (isMounted) {
        setInternalSuggestions(sensoryStorageService.getPendingSuggestions());
      }
    });
    const unsubDeals = dealsStorageService.subscribe(() => {
      if (isMounted) {
        setInternalVouchers(dealsStorageService.getVouchers());
      }
    });

    // Wire live incoming notification routing from sensoryBridge
    const routeNotification = async (payload: any) => {
      try {
        const result = intentClassifier.classify(payload);
        if (result.stream === 'actionable' && result.actionable) {
          await sensoryStorageService.addFromExtraction(result.actionable, payload);
        } else if (result.stream === 'deal' && result.deal) {
          await dealsStorageService.addFromExtraction(result.deal, payload);
          // Active notification tray clearing: dismiss promotional alert once stored in Deals Radar
          if (autoClearPromos && payload.key) {
            await sensoryBridge.dismissNotification(payload.key);
          }
        } else if (result.stream === 'noise' && autoSnoozeNoise && payload.key) {
          await sensoryBridge.snoozeNotification(payload.key, 3600000);
        }
      } catch (err) {
        console.warn('HomeScreen: Error routing live sensory notification:', err);
      }
    };

    const unsubBridge = sensoryBridge.onNotification((payload) => {
      routeNotification(payload);
    });

    const unsubDrain = sensoryBridge.initResumeDrain(async (notifications) => {
      for (const payload of notifications) {
        await routeNotification(payload);
      }
    });

    return () => {
      isMounted = false;
      unsubSensory();
      unsubDeals();
      unsubBridge();
      unsubDrain();
    };
  }, [autoClearPromos, autoSnoozeNoise]);

  const drainSensoryQueue = useCallback(async () => {
    try {
      const pending = await sensoryBridge.drainPendingNotifications();
      for (const payload of pending) {
        const result = intentClassifier.classify(payload);
        if (result.stream === 'actionable' && result.actionable) {
          await sensoryStorageService.addFromExtraction(result.actionable, payload);
        } else if (result.stream === 'deal' && result.deal) {
          await dealsStorageService.addFromExtraction(result.deal, payload);
          if (autoClearPromos && payload.key) {
            await sensoryBridge.dismissNotification(payload.key);
          }
        } else if (result.stream === 'noise' && autoSnoozeNoise && payload.key) {
          await sensoryBridge.snoozeNotification(payload.key, 3600000);
        }
      }
    } catch (err) {
      console.warn('HomeScreen: Error draining sensory notifications:', err);
    }
  }, [autoClearPromos, autoSnoozeNoise]);

  const handleToggleAutoClearPromos = useCallback(async () => {
    const nextVal = !autoClearPromos;
    if (propOnToggleAutoClearPromos) {
      propOnToggleAutoClearPromos(nextVal);
    } else {
      setInternalAutoClearPromos(nextVal);
      await sensoryBridge.setAutoClearPromos(nextVal);
      const cfg = await sensoryBridge.getFilterConfig();
      await sensoryBridge.updateFilterConfig({ ...cfg, autoClearPromos: nextVal });
    }
  }, [autoClearPromos, propOnToggleAutoClearPromos]);

  const handleToggleAutoSnoozeNoise = useCallback(async () => {
    const nextVal = !autoSnoozeNoise;
    if (propOnToggleAutoSnoozeNoise) {
      propOnToggleAutoSnoozeNoise(nextVal);
    } else {
      setInternalAutoSnoozeNoise(nextVal);
      await sensoryBridge.setAutoSnoozeNoise(nextVal);
      const cfg = await sensoryBridge.getFilterConfig();
      await sensoryBridge.updateFilterConfig({ ...cfg, autoSnoozeNoise: nextVal });
    }
  }, [autoSnoozeNoise, propOnToggleAutoSnoozeNoise]);

  const handleAcceptSuggestion = useCallback(
    async (id: string) => {
      if (propOnAcceptSuggestion) {
        await propOnAcceptSuggestion(id);
      } else {
        await sensoryStorageService.acceptSuggestion(id);
      }
    },
    [propOnAcceptSuggestion]
  );

  const handleDismissSuggestion = useCallback(
    async (id: string) => {
      if (propOnDismissSuggestion) {
        await propOnDismissSuggestion(id);
      } else {
        await sensoryStorageService.dismissSuggestion(id);
      }
    },
    [propOnDismissSuggestion]
  );

  const handleOpenRadar = useCallback(() => {
    if (propOnOpenDealsRadar) {
      propOnOpenDealsRadar();
    } else {
      setDealsRadarVisible(true);
    }
  }, [propOnOpenDealsRadar]);

  const handleOpenWatchlist = useCallback(() => {
    if (propOnOpenWatchlist) {
      propOnOpenWatchlist();
    } else {
      setWatchlistVisible(true);
    }
  }, [propOnOpenWatchlist]);

  const handleOpenBubbleSettings = useCallback(() => {
    if (propOnOpenBubbleSettings) {
      propOnOpenBubbleSettings();
    } else {
      setBubbleSettingsVisible(true);
    }
  }, [propOnOpenBubbleSettings]);

  const handleCreateCulturalItem = useCallback(
    async (input: {
      title: string;
      notes?: string | null;
      culturalMetadata: CulturalMetadata;
      dueDate?: string;
    }) => {
      await remindersHook.createReminder({
        title: input.title,
        notes: input.notes,
        dueDate: input.dueDate || new Date().toISOString(),
        armed: false,
        culturalMetadata: input.culturalMetadata,
      });
    },
    [remindersHook]
  );

  const handleCreateReminder = useCallback(
    async (input: {
      id?: string;
      title: string;
      dueDate: Date;
      preset?: CapturePreset;
      armed?: boolean;
      inkData?: string | null;
    }) => {
      if (propOnCreate) {
        await propOnCreate(input);
      } else {
        await remindersHook.createReminder({
          id: input.id,
          title: input.title,
          dueDate: input.dueDate.toISOString(),
          armed: input.armed,
          inkData: input.inkData,
        });
      }
    },
    [propOnCreate, remindersHook]
  );

  // Handle notification body tap routing
  const handleOpenSnoozeModalFromNotification = useCallback(
    (reminderId: string) => {
      const target = remindersHook.reminders.find((r) => r.id === reminderId);
      if (target) {
        setSelectedReminderForSnooze(target);
        setSnoozeModalVisible(true);
      }
    },
    [remindersHook.reminders]
  );

  useNotifications({
    onOpenSnoozeModal: handleOpenSnoozeModalFromNotification,
    onOpenWatchlist: handleOpenWatchlist,
  });

  // Check for incoming shared text from system-level ingress (Android Intent.ACTION_SEND)
  // and pending thought captures from QuickCaptureActivity
  useEffect(() => {
    let isMounted = true;
    const processIngress = async () => {
      try {
        // 1. Process shared text from ACTION_SEND
        const shared = await remyCaptureService.getSharedText();
        if (shared && shared.trim().length > 0 && isMounted) {
          const lingo = await getStoredLingo();
          const drafts = compileMultiLineCapture(shared.trim(), 'inbox', new Date(), lingo);
          for (const draft of drafts) {
            await handleCreateReminder({
              title: draft.title,
              dueDate: draft.dueDate,
              preset: draft.preset,
              armed: draft.armed,
            });
          }
          await remyCaptureService.clearSharedText();
        }

        // 2. Process pending thought captures from QuickCaptureActivity
        const pending = await remyCaptureService.getPendingCaptures();
        if (pending && pending.length > 0 && isMounted) {
          for (const item of pending) {
            await handleCreateReminder({
              id: item.id,
              title: item.title,
              dueDate: new Date(item.dueDate),
              armed: item.armed,
              inkData: item.inkData,
            });
          }
          await remyCaptureService.clearPendingCaptures();
        }

        // 3. Process widget completions & snoozes from lockscreen / homescreen widgets
        const widgetRaw = await remyCaptureService.getWidgetData();
        if (widgetRaw && widgetRaw !== '[]' && isMounted) {
          try {
            const widgetItems = JSON.parse(widgetRaw);
            if (Array.isArray(widgetItems)) {
              for (const wItem of widgetItems) {
                if (!wItem?.id) continue;
                const local = storageService.getById(wItem.id);
                if (!local) continue;
                if (wItem.status === 'completed' && local.status !== 'completed') {
                  await remindersHook.toggleComplete(wItem.id);
                } else if (
                  wItem.status === 'snoozed' &&
                  (wItem.snoozeCount || 0) > local.snoozeCount &&
                  wItem.dueDate
                ) {
                  await remindersHook.snoozeReminder(wItem.id, new Date(wItem.dueDate));
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn('HomeScreen: Error consuming ingress captures:', err);
      }
    };

    processIngress();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isMounted) {
        processIngress();
        drainSensoryQueue();
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [handleCreateReminder]);

  const reminders = propReminders ?? remindersHook.reminders;
  const activeCount = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed').length;
  const snoozedCount = reminders.filter((r) => r.snoozeCount > 0 && r.status !== 'completed').length;
  const completedCount = reminders.filter((r) => r.status === 'completed').length;


  const handleToggleComplete = async (id: string) => {
    if (propOnToggleComplete) {
      await propOnToggleComplete(id);
    } else {
      await remindersHook.toggleComplete(id);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    if (propOnDelete) {
      await propOnDelete(id);
    } else {
      await remindersHook.deleteReminder(id);
    }
  };

  const handleOpenSnooze = (reminder: Reminder) => {
    if (propOnSnooze) {
      propOnSnooze(reminder);
    } else {
      setSelectedReminderForSnooze(reminder);
      setSnoozeModalVisible(true);
    }
  };

  const handleCloseSnoozeModal = () => {
    setSnoozeModalVisible(false);
    setSelectedReminderForSnooze(null);
  };

  const handleConfirmSnooze = async (reminderId: string, targetDate: Date, preset?: SnoozePreset) => {
    await remindersHook.snoozeReminder(reminderId, targetDate, preset);
  };

  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [editModalVisible, setEditModalVisible] = useState<boolean>(false);

  const handleOpenEdit = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setEditModalVisible(true);
  };

  const handleCloseEditModal = () => {
    setEditModalVisible(false);
    setEditingReminder(null);
  };

  const handleSaveEditedReminder = async (id: string, updates: UpdateReminderInput) => {
    if (propOnUpdateReminder) {
      await propOnUpdateReminder(id, updates);
    } else {
      const updated = await remindersHook.updateReminder(id, updates);
      void cloudSyncService.syncSingleReminder(updated).catch(() => {});
    }
  };

  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const isRefreshing = propIsRefreshing ?? internalRefreshing;

  const handleRefresh = useCallback(async () => {
    if (propOnRefresh) {
      await propOnRefresh();
    } else {
      setInternalRefreshing(true);
      try {
        await Promise.all([
          cloudSyncService.syncNow(),
          drainSensoryQueue(),
        ]);
      } finally {
        setInternalRefreshing(false);
      }
    }
  }, [propOnRefresh, drainSensoryQueue]);

  const culturalCount = reminders.filter((r) => Boolean(r.culturalMetadata)).length;
  const weekendCue = getWeekendWatchlistCue(reminders, currentTime);

  return (
    <SafeAreaView testID={testID} style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <View style={styles.mainLayout}>
        <Masthead
          activeCount={activeCount}
          snoozedCount={snoozedCount}
          completedCount={completedCount}
          themeColors={colors}
          themeMode={mode}
          onCycleTheme={cycleTheme}
          onOpenDealsRadar={handleOpenRadar}
          voucherCount={vouchers.length}
          onOpenWatchlist={handleOpenWatchlist}
          watchlistCount={culturalCount}
          onOpenBubbleSettings={handleOpenBubbleSettings}
          isBubbleActive={isBubbleActive}
        />

        {/* Promotional Clutter Clearing & Deals Radar Status Banner */}
        <View
          testID="promo-radar-status-banner"
          style={[
            styles.promoRadarBanner,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.promoRadarHeaderRow}>
            <View style={styles.promoRadarTitleCluster}>
              <View
                style={[
                  styles.promoRadarSignalDot,
                  { backgroundColor: autoClearPromos ? colors.accent : '#6B7280' },
                ]}
              />
              <Text
                testID="promo-radar-status-tag"
                style={[
                  styles.promoRadarTag,
                  { color: autoClearPromos ? colors.accent : colors.textMuted },
                ]}
              >
                {autoClearPromos ? 'PROMO CLEARING ACTIVE · STATUS BAR CALM' : 'PROMO AUTO-CLEAR PAUSED'}
              </Text>
            </View>

            <View style={styles.promoRadarActionsCluster}>
              <TouchableOpacity
                testID="toggle-auto-clear-promos"
                onPress={handleToggleAutoClearPromos}
                activeOpacity={0.7}
                style={[
                  styles.promoToggleBtn,
                  {
                    borderColor: autoClearPromos ? colors.accent : colors.border,
                    backgroundColor: autoClearPromos ? colors.accentSubtle : colors.surfaceSubtle,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Toggle auto-clear promotional notifications: currently ${autoClearPromos ? 'ON' : 'OFF'}`}
              >
                <Text
                  style={[
                    styles.promoToggleText,
                    { color: autoClearPromos ? colors.accent : colors.textMuted },
                  ]}
                >
                  AUTO-CLEAR: {autoClearPromos ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                testID="toggle-auto-snooze-noise"
                onPress={handleToggleAutoSnoozeNoise}
                activeOpacity={0.7}
                style={[
                  styles.promoToggleBtn,
                  {
                    borderColor: autoSnoozeNoise ? colors.accent : colors.border,
                    backgroundColor: autoSnoozeNoise ? colors.accentSubtle : colors.surfaceSubtle,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Toggle auto-snooze noise alerts: currently ${autoSnoozeNoise ? 'ON' : 'OFF'}`}
              >
                <Text
                  style={[
                    styles.promoToggleText,
                    { color: autoSnoozeNoise ? colors.accent : colors.textMuted },
                  ]}
                >
                  SNOOZE NOISE: {autoSnoozeNoise ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.promoRadarBodyRow}>
            <Text style={[styles.promoRadarDescription, { color: colors.textSecondary }]}>
              {autoClearPromos
                ? `Promos parsed to Deals Radar (${vouchers.length} saved) · Status bar kept distraction-free`
                : 'Promotions will accumulate in system tray until cleared manually'}
              {autoSnoozeNoise ? ' · Noise snoozed' : ''}
            </Text>

            <TouchableOpacity
              testID="open-deals-radar-banner-btn"
              onPress={handleOpenRadar}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.promoRadarLink, { color: colors.accent }]}>
                RADAR [{vouchers.length}] →
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <SensoryInboxShelf
          suggestions={suggestions}
          onAccept={handleAcceptSuggestion}
          onDismiss={handleDismissSuggestion}
          onOpenDealsRadar={handleOpenRadar}
          themeColors={colors}
        />

        {/* Contextual Weekend Watchlist Surfacing Banner */}
        {weekendCue.isWeekendCueActive && (
          <TouchableOpacity
            testID="home-weekend-cue-banner"
            style={styles.weekendCueBanner}
            onPress={handleOpenWatchlist}
            activeOpacity={0.8}
            accessibilityLabel="Open Weekend Watchlist"
          >
            <View style={styles.weekendCueHeader}>
              <Text style={styles.weekendCueTag}>WEEKEND SURFACING</Text>
              <Text style={styles.weekendCueCount}>{weekendCue.count} READY</Text>
            </View>
            <Text style={styles.weekendCueTitle}>WEEKEND WATCHLIST</Text>
            <Text style={styles.weekendCueSubtext}>{weekendCue.subtext} · TAP TO VIEW</Text>
          </TouchableOpacity>
        )}

        <View style={styles.listWrapper}>
          <ReminderList
            reminders={reminders}
            themeColors={colors}
            onToggleComplete={handleToggleComplete}
            onSnoozePress={handleOpenSnooze}
            onDeletePress={handleDeleteReminder}
            onEditPress={handleOpenEdit}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
          />
        </View>

        <QuickCaptureBar
          onCreateReminder={handleCreateReminder}
          themeColors={colors}
          showInkCapture={false}
        />

        <SnoozeModal
          visible={snoozeModalVisible}
          reminder={selectedReminderForSnooze}
          onClose={handleCloseSnoozeModal}
          onSnooze={handleConfirmSnooze}
          themeColors={colors}
        />

        <EditReminderModal
          visible={editModalVisible}
          reminder={editingReminder}
          onClose={handleCloseEditModal}
          onSave={handleSaveEditedReminder}
          themeColors={colors}
        />

        <Modal
          visible={dealsRadarVisible}
          animationType="slide"
          onRequestClose={() => setDealsRadarVisible(false)}
        >
          <DealsRadarScreen
            vouchers={vouchers}
            onCopyVoucher={async (id) => {
              await dealsStorageService.recordCopy(id);
            }}
            onPurgeExpired={async () => {
              await dealsStorageService.purgeExpired();
            }}
            onBack={() => setDealsRadarVisible(false)}
            onClose={() => setDealsRadarVisible(false)}
            themeColors={colors}
          />
        </Modal>

        <Modal
          visible={watchlistVisible}
          animationType="slide"
          onRequestClose={() => setWatchlistVisible(false)}
        >
          <WatchlistScreen
            reminders={reminders}
            onCreateCulturalItem={handleCreateCulturalItem}
            onToggleComplete={handleToggleComplete}
            onDeleteReminder={handleDeleteReminder}
            onSnoozeReminder={async (id, target) => {
              await remindersHook.snoozeReminder(id, target);
            }}
            onBack={() => setWatchlistVisible(false)}
            onClose={() => setWatchlistVisible(false)}
            themeColors={colors}
            currentTime={currentTime}
          />
        </Modal>

        <BubbleSettingsModal
          visible={bubbleSettingsVisible}
          onClose={() => {
            setBubbleSettingsVisible(false);
            remyCaptureService.isBubbleRunning().then(setIsBubbleActive).catch(() => {});
          }}
          themeColors={colors}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mainLayout: {
    flex: 1,
  },
  listWrapper: {
    flex: 1,
  },
  weekendCueBanner: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
  },
  weekendCueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  weekendCueTag: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  weekendCueCount: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  weekendCueTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  weekendCueSubtext: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  promoRadarBanner: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 0,
  },
  promoRadarHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 6,
  },
  promoRadarTitleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  promoRadarSignalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  promoRadarTag: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  promoRadarActionsCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  promoToggleBtn: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
  },
  promoToggleText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  promoRadarBodyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  promoRadarDescription: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
    flex: 1,
    marginRight: 8,
  },
  promoRadarLink: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});

export default HomeScreen;
