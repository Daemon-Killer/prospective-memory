import React, { useState, useMemo, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Reminder, CulturalMediaType, CulturalMetadata } from '../types/reminder';
import { ThemeColors } from '../types/theme';
import { ThemeContext } from '../theme/ThemeContext';
import { darkColors } from '../theme/colors';
import {
  parseCulturalCapture,
  getWeekendWatchlistCue,
  formatCulturalBadge,
  POPULAR_PLATFORMS,
} from '../utils/watchlistParser';
import { notificationService } from '../services/notificationService';

export interface WatchlistScreenProps {
  reminders: Reminder[];
  onCreateCulturalItem?: (input: {
    title: string;
    notes?: string | null;
    culturalMetadata: CulturalMetadata;
    dueDate?: string;
  }) => Promise<void> | void;
  onToggleComplete?: (id: string) => Promise<void> | void;
  onDeleteReminder?: (id: string) => Promise<void> | void;
  onSnoozeReminder?: (id: string, targetDate: Date) => Promise<void> | void;
  onClose?: () => void;
  onBack?: () => void;
  themeColors?: ThemeColors;
  currentTime?: Date;
  testID?: string;
}

type TabType = 'all' | 'movie' | 'show' | 'book' | 'documentary';

export const WatchlistScreen: React.FC<WatchlistScreenProps> = ({
  reminders,
  onCreateCulturalItem,
  onToggleComplete,
  onDeleteReminder,
  onSnoozeReminder,
  onClose,
  onBack,
  themeColors: propColors,
  currentTime: propCurrentTime,
  testID = 'watchlist-screen',
}) => {
  const themeContext = React.useContext(ThemeContext);
  const colors = propColors ?? themeContext?.colors ?? darkColors;

  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ALL');
  const [inputText, setInputText] = useState<string>('');
  const [selectedMediaType, setSelectedMediaType] = useState<CulturalMediaType>('movie');

  // Filter cultural items
  const culturalItems = useMemo(() => {
    return reminders.filter((r) => Boolean(r.culturalMetadata));
  }, [reminders]);

  const filteredItems = useMemo(() => {
    return culturalItems.filter((item) => {
      const meta = item.culturalMetadata;
      if (!meta) return false;

      // Tab filter
      if (activeTab !== 'all') {
        if (activeTab === 'movie' && meta.mediaType !== 'movie') return false;
        if (activeTab === 'show' && meta.mediaType !== 'show') return false;
        if (activeTab === 'book' && meta.mediaType !== 'book') return false;
        if (activeTab === 'documentary' && meta.mediaType !== 'documentary') return false;
      }

      // Platform filter
      if (selectedPlatform !== 'ALL') {
        if (!meta.platform || meta.platform.toLowerCase() !== selectedPlatform.toLowerCase()) {
          return false;
        }
      }

      return true;
    });
  }, [culturalItems, activeTab, selectedPlatform]);

  const weekendCue = useMemo(() => {
    return getWeekendWatchlistCue(reminders, propCurrentTime);
  }, [reminders, propCurrentTime]);

  useEffect(() => {
    notificationService
      .reconcileWeekendWatchlistNotification(reminders, propCurrentTime)
      .catch(() => {});
  }, [reminders, propCurrentTime]);

  const handleCapture = async () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const { title, notes: parsedNotes, metadata } = parseCulturalCapture(trimmed, selectedMediaType);

    if (onCreateCulturalItem) {
      const combinedNotes = [
        metadata.recommendedBy ? `Rec by ${metadata.recommendedBy}` : null,
        metadata.creator ? `By ${metadata.creator}` : null,
        parsedNotes,
      ]
        .filter(Boolean)
        .join(' · ');

      await onCreateCulturalItem({
        title,
        notes: combinedNotes || null,
        culturalMetadata: metadata,
        dueDate: new Date().toISOString(),
      });
    }

    setInputText('');
  };

  const handleSnoozeToWeekend = async (item: Reminder) => {
    if (!onSnoozeReminder) return;

    // Calculate upcoming Friday 20:00 or Saturday
    const baseTime = propCurrentTime || new Date();
    const target = new Date(baseTime);
    const day = target.getDay();
    const daysUntilFriday = (5 - day + 7) % 7;
    target.setDate(target.getDate() + (daysUntilFriday === 0 ? 0 : daysUntilFriday));
    target.setHours(20, 0, 0, 0);

    await onSnoozeReminder(item.id, target);
  };

  return (
    <SafeAreaView testID={testID} style={[styles.container, { backgroundColor: '#000000' }]}>
      {/* Swiss Void Architectural Header */}
      <View style={[styles.header, { borderBottomColor: '#262626' }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerSubtitle}>PROSPECTIVE MEMORY // LEISURE</Text>
          <Text testID="watchlist-header-title" style={styles.headerTitle}>
            WATCHLIST
          </Text>
        </View>
        <View style={styles.headerActions}>
          <View testID="watchlist-total-badge" style={styles.counterBadge}>
            <Text style={styles.counterBadgeText}>{culturalItems.length}</Text>
          </View>
          {(onClose || onBack) && (
            <TouchableOpacity
              testID="watchlist-close-btn"
              style={styles.closeButton}
              onPress={onClose || onBack}
              accessibilityLabel="Close Watchlist"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Contextual Weekend Surfacing Banner */}
      {weekendCue.isWeekendCueActive && (
        <View testID="weekend-watchlist-banner" style={styles.weekendBanner}>
          <View style={styles.weekendBannerContent}>
            <Text style={styles.weekendBannerTag}>FRIDAY · SATURDAY · SUNDAY</Text>
            <Text style={styles.weekendBannerTitle}>{weekendCue.headline}</Text>
            <Text style={styles.weekendBannerSubtext}>{weekendCue.subtext}</Text>
          </View>
          <View style={styles.weekendBannerPill}>
            <Text style={styles.weekendBannerPillText}>QUEUED</Text>
          </View>
        </View>
      )}

      {/* Quick Capture Form */}
      <View style={[styles.captureSection, { borderBottomColor: '#262626' }]}>
        <View style={styles.mediaTypeRow}>
          {(['movie', 'show', 'book', 'documentary'] as CulturalMediaType[]).map((type) => {
            const isSelected = selectedMediaType === type;
            return (
              <TouchableOpacity
                key={type}
                testID={`media-type-btn-${type}`}
                style={[
                  styles.mediaTypeChip,
                  isSelected ? styles.mediaTypeChipActive : styles.mediaTypeChipInactive,
                ]}
                onPress={() => setSelectedMediaType(type)}
              >
                <Text
                  style={[
                    styles.mediaTypeChipText,
                    isSelected ? styles.mediaTypeChipTextActive : styles.mediaTypeChipTextInactive,
                  ]}
                >
                  {type.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.inputRow}>
          <TextInput
            testID="watchlist-input"
            style={styles.textInput}
            placeholder={`Log ${selectedMediaType} (e.g. Inception on Netflix 2010 #scifi)...`}
            placeholderTextColor="#666666"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleCapture}
            returnKeyType="done"
          />
          <TouchableOpacity
            testID="watchlist-add-btn"
            style={styles.addButton}
            onPress={handleCapture}
            activeOpacity={0.8}
          >
            <Text style={styles.addButtonText}>+ ADD</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsRow}>
        {(['all', 'movie', 'show', 'book', 'documentary'] as TabType[]).map((tab) => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              testID={`watchlist-tab-${tab}`}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Platform Filter Chips Horizontal Scroll */}
      <View style={styles.platformsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.platformsScroll}
        >
          {['ALL', ...POPULAR_PLATFORMS].map((plat) => {
            const isSelected = selectedPlatform.toLowerCase() === plat.toLowerCase();
            return (
              <TouchableOpacity
                key={plat}
                testID={`platform-chip-${plat.replace(/\s+/g, '-').toLowerCase()}`}
                style={[
                  styles.platformChip,
                  isSelected ? styles.platformChipActive : styles.platformChipInactive,
                ]}
                onPress={() => setSelectedPlatform(plat)}
              >
                <Text
                  style={[
                    styles.platformChipText,
                    isSelected ? styles.platformChipTextActive : styles.platformChipTextInactive,
                  ]}
                >
                  {plat.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Ledger Items List */}
      <FlatList
        testID="watchlist-items-list"
        data={filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={() => (
          <View testID="watchlist-empty-state" style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>NO CULTURAL RECS QUEUED</Text>
            <Text style={styles.emptySubtitle}>
              Log movies, shows, books, and documentaries to build your prospective leisure ledger.
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const meta = item.culturalMetadata;
          const isDone = item.status === 'completed';
          const badgeText = meta ? formatCulturalBadge(meta) : 'LEISURE';

          return (
            <View
              testID={`watchlist-card-${item.id}`}
              style={[styles.itemCard, isDone && styles.itemCardCompleted]}
            >
              <View style={styles.itemHeaderRow}>
                <View style={styles.badgeCluster}>
                  <Text testID={`watchlist-badge-${item.id}`} style={styles.itemBadgeText}>
                    {badgeText}
                  </Text>
                  {meta?.genres && meta.genres.length > 0 && (
                    <Text style={styles.genreTags}>
                      {meta.genres.map((g) => `#${g}`).join(' ')}
                    </Text>
                  )}
                </View>
                {meta?.recommendedBy ? (
                  <Text style={styles.recommenderText}>VIA {meta.recommendedBy.toUpperCase()}</Text>
                ) : meta?.creator ? (
                  <Text style={styles.recommenderText}>BY {meta.creator.toUpperCase()}</Text>
                ) : null}
              </View>

              <Text
                testID={`watchlist-title-${item.id}`}
                style={[styles.itemTitle, isDone && styles.itemTitleCompleted]}
              >
                {item.title}
              </Text>

              {item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}

              <View style={styles.itemActionsRow}>
                <TouchableOpacity
                  testID={`watchlist-complete-btn-${item.id}`}
                  style={[
                    styles.itemActionBtn,
                    isDone ? styles.itemActionBtnActive : styles.itemActionBtnSecondary,
                  ]}
                  onPress={() => onToggleComplete && onToggleComplete(item.id)}
                >
                  <Text style={styles.itemActionBtnText}>
                    {isDone ? '✓ WATCHED' : 'MARK WATCHED'}
                  </Text>
                </TouchableOpacity>

                {!isDone && (
                  <TouchableOpacity
                    testID={`watchlist-weekend-btn-${item.id}`}
                    style={[styles.itemActionBtn, styles.itemActionBtnSecondary]}
                    onPress={() => handleSnoozeToWeekend(item)}
                  >
                    <Text style={styles.itemActionBtnText}>FOR WEEKEND</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  testID={`watchlist-delete-btn-${item.id}`}
                  style={[styles.itemActionBtn, styles.itemActionBtnDanger]}
                  onPress={() => onDeleteReminder && onDeleteReminder(item.id)}
                >
                  <Text style={styles.itemActionBtnDangerText}>DEL</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex: 1,
  },
  headerSubtitle: {
    color: '#666666',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  counterBadge: {
    backgroundColor: '#1A1A1A',
    borderColor: '#333333',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  counterBadgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  closeButton: {
    padding: 6,
  },
  closeButtonText: {
    color: '#888888',
    fontSize: 20,
    fontWeight: '700',
  },
  weekendBanner: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekendBannerContent: {
    flex: 1,
  },
  weekendBannerTag: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  weekendBannerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  weekendBannerSubtext: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  weekendBannerPill: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  weekendBannerPillText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  captureSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  mediaTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  mediaTypeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  mediaTypeChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  mediaTypeChipInactive: {
    backgroundColor: '#111111',
    borderColor: '#262626',
  },
  mediaTypeChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  mediaTypeChipTextActive: {
    color: '#000000',
  },
  mediaTypeChipTextInactive: {
    color: '#888888',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#111111',
    borderColor: '#262626',
    borderWidth: 1,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  addButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
    paddingHorizontal: 16,
  },
  tabButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#FFFFFF',
  },
  tabText: {
    color: '#666666',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  platformsContainer: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  platformsScroll: {
    paddingHorizontal: 16,
    gap: 6,
  },
  platformChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  platformChipActive: {
    backgroundColor: '#262626',
    borderColor: '#FFFFFF',
  },
  platformChipInactive: {
    backgroundColor: '#0D0D0D',
    borderColor: '#1E1E1E',
  },
  platformChipText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  platformChipTextActive: {
    color: '#FFFFFF',
  },
  platformChipTextInactive: {
    color: '#666666',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  itemCard: {
    backgroundColor: '#0A0A0A',
    borderColor: '#262626',
    borderWidth: 1,
    padding: 14,
  },
  itemCardCompleted: {
    opacity: 0.5,
    borderColor: '#1A1A1A',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  badgeCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  itemBadgeText: {
    color: '#A3A3A3',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  genreTags: {
    color: '#666666',
    fontSize: 10,
    fontWeight: '700',
  },
  recommenderText: {
    color: '#888888',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  itemTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#666666',
  },
  itemNotes: {
    color: '#888888',
    fontSize: 12,
    marginBottom: 8,
  },
  itemActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  itemActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  itemActionBtnActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  itemActionBtnSecondary: {
    backgroundColor: '#141414',
    borderColor: '#262626',
  },
  itemActionBtnDanger: {
    backgroundColor: '#141414',
    borderColor: '#262626',
  },
  itemActionBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  itemActionBtnDangerText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: '#444444',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#333333',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
});

export default WatchlistScreen;
