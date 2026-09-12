import React, { useState, useEffect } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { ThemeColors } from '../types/theme';
import {
  cloudSyncService,
  CloudSyncState,
  CloudConfig,
} from '../services/cloudSyncService';

export interface CloudSyncModalProps {
  visible: boolean;
  onClose: () => void;
  colors: ThemeColors;
}

export const CloudSyncModal: React.FC<CloudSyncModalProps> = ({
  visible,
  onClose,
  colors,
}) => {
  const [syncState, setSyncState] = useState<CloudSyncState>(cloudSyncService.getState());
  const [config, setConfig] = useState<CloudConfig>(cloudSyncService.getConfig());
  const [urlInput, setUrlInput] = useState(config.apiUrl);
  const [tokenInput, setTokenInput] = useState(config.token);
  const [enabledInput, setEnabledInput] = useState(config.enabled);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = cloudSyncService.subscribe((state, cfg) => {
      setSyncState(state);
      setConfig(cfg);
      setUrlInput(cfg.apiUrl);
      setTokenInput(cfg.token);
      setEnabledInput(cfg.enabled);
    });
    return unsubscribe;
  }, []);

  const handleSyncNow = async () => {
    setLastMessage('Syncing with cloud...');
    const res = await cloudSyncService.syncNow();
    if (res.success) {
      setLastMessage(`Synced ${res.syncedCount} items successfully.`);
    } else {
      setLastMessage(`Sync error: ${res.error || 'Check credentials'}`);
    }
  };

  const handleSave = async () => {
    await cloudSyncService.updateConfig({
      apiUrl: urlInput,
      token: tokenInput,
      enabled: enabledInput,
    });
    setLastMessage('Configuration saved.');
  };

  const getStatusBadge = () => {
    switch (syncState) {
      case 'syncing':
        return { label: 'SYNCING', color: '#3B82F6' };
      case 'synced':
        return { label: 'CONNECTED & SYNCED', color: '#10B981' };
      case 'error':
        return { label: 'SYNC ERROR', color: '#EF4444' };
      case 'disabled':
        return { label: 'DISABLED', color: '#6B7280' };
      default:
        return { label: 'IDLE', color: '#10B981' };
    }
  };

  const badge = getStatusBadge();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderStrong,
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                Cloud Sync (Render API)
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={[styles.closeBtn, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Status indicator */}
            <View style={styles.statusBox}>
              <View style={[styles.dot, { backgroundColor: badge.color }]} />
              <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
            </View>

            {config.lastSyncTime && (
              <Text style={[styles.timeText, { color: colors.textMuted }]}>
                Last Sync: {new Date(config.lastSyncTime).toLocaleTimeString()}
              </Text>
            )}

            {cloudSyncService.getErrorMessage() && (
              <Text style={[styles.errorText, { color: '#EF4444' }]}>
                {cloudSyncService.getErrorMessage()}
              </Text>
            )}

            {lastMessage && (
              <Text style={[styles.infoText, { color: colors.accent }]}>
                {lastMessage}
              </Text>
            )}

            {/* Sync Now Button */}
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: colors.accent },
                syncState === 'syncing' && { opacity: 0.7 },
              ]}
              onPress={handleSyncNow}
              disabled={syncState === 'syncing'}
            >
              {syncState === 'syncing' ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.actionBtnText}>⚡ Sync Now</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Server Settings */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Server Configuration
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>API Endpoint</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              value={urlInput}
              onChangeText={setUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://prospective-memory-api.onrender.com"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>API Auth Token (X-PMEM-TOKEN)</Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              value={tokenInput}
              onChangeText={setTokenInput}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="Enter token"
              placeholderTextColor={colors.textMuted}
            />

            <TouchableOpacity
              style={[
                styles.saveBtn,
                {
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.surfaceSubtle || colors.background,
                },
              ]}
              onPress={handleSave}
            >
              <Text style={[styles.saveBtnText, { color: colors.textPrimary }]}>
                Save Settings
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  scrollContent: {
    padding: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeBtn: {
    fontSize: 20,
    fontWeight: '600',
    padding: 4,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timeText: {
    fontSize: 12,
    marginBottom: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  actionBtn: {
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#333333',
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
    marginBottom: 8,
  },
  saveBtn: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
export default CloudSyncModal;
