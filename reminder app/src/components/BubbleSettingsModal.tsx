import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { ThemeColors } from '../types/theme';
import { remyCaptureService } from '../services/remyCaptureService';

export interface BubbleSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  themeColors?: ThemeColors;
  testID?: string;
}

export const BubbleSettingsModal: React.FC<BubbleSettingsModalProps> = ({
  visible,
  onClose,
  themeColors,
  testID = 'bubble-settings-modal',
}) => {
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const perm = await remyCaptureService.canDrawOverlays();
      const running = await remyCaptureService.isBubbleRunning();
      setHasPermission(perm);
      setIsRunning(running);
    } catch {
      setHasPermission(false);
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      checkStatus();
      setMessage(null);
    }
  }, [visible, checkStatus]);

  const handleRequestPermission = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const granted = await remyCaptureService.requestOverlayPermission();
      setHasPermission(granted);
      if (!granted) {
        setMessage('Permission requested. Grant "Display over other apps" in Settings, then return.');
      }
    } catch (e: any) {
      setMessage(`Error requesting permission: ${e?.message || 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBubble = async () => {
    setLoading(true);
    setMessage(null);
    try {
      if (isRunning) {
        await remyCaptureService.stopBubble();
        setIsRunning(false);
        setMessage('Floating bubble stopped.');
      } else {
        if (!hasPermission) {
          const perm = await remyCaptureService.canDrawOverlays();
          if (!perm) {
            setMessage('SYSTEM_ALERT_WINDOW permission required before starting bubble.');
            setLoading(false);
            return;
          }
          setHasPermission(true);
        }
        const ok = await remyCaptureService.startBubble();
        if (ok) {
          setIsRunning(true);
          setMessage('Floating bubble active! Tap + over any app to capture thoughts.');
        } else {
          setMessage('Could not start bubble service.');
        }
      }
    } catch (e: any) {
      setMessage(`Error toggling bubble: ${e?.message || 'Unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      testID={testID}
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.kicker}>ANDROID SYSTEM OVERLAY</Text>
              <Text style={styles.title}>FLOATING BUBBLE</Text>
            </View>
            <TouchableOpacity
              testID="bubble-settings-close-btn"
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Edge-docked '+' thought capture overlay that floats over any active app (YouTube, WhatsApp, Twitter). Tap it to log thoughts instantly without losing context.
          </Text>

          {/* Status Indicators */}
          <View style={styles.statusBox}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>OVERLAY PERMISSION</Text>
              <View style={styles.statusValueRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: hasPermission ? '#10B981' : '#EF4444' },
                  ]}
                />
                <Text
                  testID="bubble-permission-status"
                  style={[
                    styles.statusValue,
                    { color: hasPermission ? '#10B981' : '#EF4444' },
                  ]}
                >
                  {hasPermission ? 'GRANTED' : 'REQUIRED'}
                </Text>
              </View>
            </View>

            <View style={[styles.statusRow, { marginTop: 8 }]}>
              <Text style={styles.statusLabel}>BUBBLE SERVICE</Text>
              <View style={styles.statusValueRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isRunning ? '#38BDF8' : '#6B7280' },
                  ]}
                />
                <Text
                  testID="bubble-running-status"
                  style={[
                    styles.statusValue,
                    { color: isRunning ? '#38BDF8' : '#6B7280' },
                  ]}
                >
                  {isRunning ? 'ACTIVE' : 'INACTIVE'}
                </Text>
              </View>
            </View>
          </View>

          {message && (
            <View testID="bubble-message-box" style={styles.messageBox}>
              <Text style={styles.messageText}>{message}</Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionGroup}>
            {!hasPermission ? (
              <TouchableOpacity
                testID="bubble-request-perm-btn"
                style={styles.primaryButton}
                onPress={handleRequestPermission}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000000" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>GRANT OVERLAY PERMISSION</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                testID="bubble-toggle-service-btn"
                style={[
                  styles.primaryButton,
                  isRunning ? styles.buttonStop : styles.buttonStart,
                ]}
                onPress={handleToggleBubble}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.toggleButtonText}>
                    {isRunning ? 'STOP FLOATING BUBBLE' : 'START FLOATING BUBBLE'}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              testID="bubble-refresh-btn"
              style={styles.secondaryButton}
              onPress={checkStatus}
            >
              <Text style={styles.secondaryButtonText}>REFRESH STATUS</Text>
            </TouchableOpacity>
          </View>

          {/* User Instructions */}
          <View style={styles.instructionsBox}>
            <Text style={styles.instructionsTitle}>GESTURE CONTROLS</Text>
            <Text style={styles.instructionItem}>• TAP + : Opens instant thought capture over foreground app</Text>
            <Text style={styles.instructionItem}>• DRAG : Repositions bubble along vertical screen edges</Text>
            <Text style={styles.instructionItem}>• DRAG TO ✕ : Drops onto bottom dismiss zone to hide</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#000000',
    borderColor: '#262626',
    borderWidth: 1,
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerTitleGroup: {
    flex: 1,
  },
  kicker: {
    color: '#666666',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: '#888888',
    fontSize: 18,
    fontWeight: '700',
  },
  description: {
    color: '#A3A3A3',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  statusBox: {
    backgroundColor: '#0D0D0D',
    borderColor: '#1E1E1E',
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    color: '#666666',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  statusValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusValue: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  messageBox: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    padding: 10,
    marginBottom: 16,
  },
  messageText: {
    color: '#38BDF8',
    fontSize: 11,
    lineHeight: 16,
  },
  actionGroup: {
    gap: 10,
    marginBottom: 16,
  },
  primaryButton: {
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  buttonStart: {
    backgroundColor: '#10B981',
  },
  buttonStop: {
    backgroundColor: '#EF4444',
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  toggleButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  secondaryButton: {
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderColor: '#262626',
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: '#A3A3A3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  instructionsBox: {
    borderTopColor: '#1A1A1A',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  instructionsTitle: {
    color: '#666666',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  instructionItem: {
    color: '#888888',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
  },
});

export default BubbleSettingsModal;
