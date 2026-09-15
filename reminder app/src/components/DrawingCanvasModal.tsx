import React, { useState, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  PanResponder,
  Platform,
  ScrollView,
  GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { CapturePreset } from '../utils/captureCompiler';
import { ThemeColors } from '../types/theme';
import { useTheme } from '../theme/ThemeContext';

export interface InkPoint {
  x: number;
  y: number;
}

export interface InkStroke {
  color: string;
  width: number;
  points: InkPoint[];
}

export interface DrawingCanvasModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    dueDate: Date;
    preset?: CapturePreset;
    armed?: boolean;
    inkData: string;
  }) => Promise<void> | void;
  themeColors?: ThemeColors;
}

const PALETTE = [
  { id: 'white', color: '#FFFFFF', label: 'WHITE' },
  { id: 'cyan', color: '#80CBC4', label: 'CYAN' },
  { id: 'amber', color: '#F59E0B', label: 'AMBER' },
  { id: 'coral', color: '#EF4444', label: 'CORAL' },
];

const WIDTHS = [
  { id: 'thin', width: 2.5, label: 'FINE' },
  { id: 'medium', width: 4.5, label: 'MED' },
  { id: 'thick', width: 7.5, label: 'BOLD' },
];

const PRESETS: { id: CapturePreset; label: string }[] = [
  { id: 'inbox', label: 'INBOX' },
  { id: '15m', label: '+15M' },
  { id: '1h', label: '+1H' },
  { id: 'evening', label: 'TONIGHT' },
  { id: 'tomorrow_morning', label: 'TOMORROW 9AM' },
];

/**
 * Converts strokes to a compact normalized JSON string
 */
export function serializeStrokes(strokes: InkStroke[], canvasWidth: number = 320, canvasHeight: number = 240): string {
  const normW = Math.max(canvasWidth, 1);
  const normH = Math.max(canvasHeight, 1);
  return JSON.stringify({
    v: 1,
    w: Math.round(normW),
    h: Math.round(normH),
    strokes: strokes.map((s) => ({
      c: s.color,
      w: s.width,
      pts: s.points.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
    })),
  });
}

/**
 * Parses serialized stroke data back into InkStroke array
 */
export function deserializeStrokes(json: string): { strokes: InkStroke[]; width: number; height: number } {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.strokes)) {
      return { strokes: [], width: 320, height: 240 };
    }
    const strokes: InkStroke[] = parsed.strokes.map((s: any) => ({
      color: s.c || '#FFFFFF',
      width: s.w || 3,
      points: Array.isArray(s.pts) ? s.pts.map(([x, y]: [number, number]) => ({ x, y })) : [],
    }));
    return {
      strokes,
      width: parsed.w || 320,
      height: parsed.h || 240,
    };
  } catch {
    return { strokes: [], width: 320, height: 240 };
  }
}

/**
 * Generate SVG Path string (d attribute) from an array of InkPoints
 */
export function pointsToSvgPath(points: InkPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} l 0.1 0.1`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

import { voidColors } from '../theme/colors';

function useSafeThemeColors(propColors?: ThemeColors): ThemeColors {
  try {
    const theme = useTheme();
    return propColors ?? theme.colors;
  } catch {
    return propColors ?? voidColors;
  }
}

export const DrawingCanvasModal: React.FC<DrawingCanvasModalProps> = ({
  visible,
  onClose,
  onSave,
  themeColors: propColors,
}) => {
  const themeColors = useSafeThemeColors(propColors);

  const [title, setTitle] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<CapturePreset>('inbox');
  const [selectedColor, setSelectedColor] = useState('#FFFFFF');
  const [selectedWidth, setSelectedWidth] = useState(4.5);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<InkPoint[]>([]);
  const [canvasLayout, setCanvasLayout] = useState<{ width: number; height: number }>({ width: 320, height: 240 });
  const [isSaving, setIsSaving] = useState(false);

  const strokesRef = useRef<InkStroke[]>([]);
  strokesRef.current = strokes;

  const currentStrokeRef = useRef<InkPoint[]>([]);
  currentStrokeRef.current = currentStroke;

  const selectedColorRef = useRef(selectedColor);
  selectedColorRef.current = selectedColor;

  const selectedWidthRef = useRef(selectedWidth);
  selectedWidthRef.current = selectedWidth;

  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          const initialPoint: InkPoint = { x: locationX, y: locationY };
          currentStrokeRef.current = [initialPoint];
          setCurrentStroke([initialPoint]);
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          const newPt: InkPoint = { x: locationX, y: locationY };
          const updated = [...currentStrokeRef.current, newPt];
          currentStrokeRef.current = updated;
          setCurrentStroke(updated);
        },
        onPanResponderRelease: () => {
          if (currentStrokeRef.current.length > 0) {
            const finishedStroke: InkStroke = {
              color: selectedColorRef.current,
              width: selectedWidthRef.current,
              points: [...currentStrokeRef.current],
            };
            const updatedStrokes = [...strokesRef.current, finishedStroke];
            strokesRef.current = updatedStrokes;
            setStrokes(updatedStrokes);
          }
          currentStrokeRef.current = [];
          setCurrentStroke([]);
        },
        onPanResponderTerminate: () => {
          currentStrokeRef.current = [];
          setCurrentStroke([]);
        },
      }),
    []
  );

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    if (Platform.OS !== 'web') {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch {}
    }
    setStrokes((prev) => prev.slice(0, -1));
  }, [strokes.length]);

  const handleClear = useCallback(() => {
    if (Platform.OS !== 'web') {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } catch {}
    }
    setStrokes([]);
    setCurrentStroke([]);
  }, []);

  const calculateDueDate = useCallback((preset: CapturePreset): { dueDate: Date; armed: boolean } => {
    const now = new Date();
    switch (preset) {
      case '15m':
        return { dueDate: new Date(now.getTime() + 15 * 60 * 1000), armed: true };
      case '1h':
        return { dueDate: new Date(now.getTime() + 60 * 60 * 1000), armed: true };
      case 'evening': {
        const d = new Date(now);
        if (d.getHours() >= 20) {
          d.setHours(d.getHours() + 2);
        } else {
          d.setHours(20, 0, 0, 0);
        }
        return { dueDate: d, armed: true };
      }
      case 'tomorrow_morning': {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return { dueDate: d, armed: true };
      }
      default:
        return { dueDate: now, armed: false };
    }
  }, []);

  const handleSave = async () => {
    if (strokes.length === 0 && currentStroke.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    if (Platform.OS !== 'web') {
      try {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch {}
    }

    try {
      const allStrokes = [...strokes];
      if (currentStroke.length > 0) {
        allStrokes.push({
          color: selectedColor,
          width: selectedWidth,
          points: currentStroke,
        });
      }

      const serialized = serializeStrokes(allStrokes, canvasLayout.width, canvasLayout.height);
      const computedTitle = title.trim().length > 0
        ? title.trim()
        : `Sketch Note · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      const { dueDate, armed } = calculateDueDate(selectedPreset);

      await onSave({
        title: computedTitle,
        dueDate,
        preset: selectedPreset,
        armed,
        inkData: serialized,
      });

      // Reset
      setTitle('');
      setStrokes([]);
      setCurrentStroke([]);
      onClose();
    } catch (err) {
      console.error('DrawingCanvasModal: Save error', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="drawing-canvas-modal"
    >
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: '#000000', borderColor: '#262626' },
          ]}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>STYLUS &amp; INK CANVAS</Text>
              <Text style={styles.headerSubtitle}>Rapid visual thought capture · Swiss Void</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              testID="canvas-close-btn"
              accessibilityLabel="Close Canvas"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Title Input */}
          <TextInput
            style={[
              styles.titleInput,
              { backgroundColor: '#0D0D0D', borderColor: '#262626', color: '#FFFFFF' },
            ]}
            placeholder="NOTE TITLE / SUMMARY (OPTIONAL)"
            placeholderTextColor="#555555"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            testID="canvas-title-input"
          />

          {/* Presets Horizontal Scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.presetsContainer}
          >
            {PRESETS.map((p) => {
              const isSelected = selectedPreset === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[
                    styles.presetChip,
                    isSelected && styles.presetChipSelected,
                  ]}
                  onPress={() => setSelectedPreset(p.id)}
                  testID={`canvas-chip-${p.id}`}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      isSelected && styles.presetChipTextSelected,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Drawing Canvas Board */}
          <View
            style={styles.canvasWrapper}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setCanvasLayout({ width, height });
            }}
            {...handlePanResponder.panHandlers}
            testID="canvas-touch-area"
          >
            {/* Background grid dots / watermark */}
            {strokes.length === 0 && currentStroke.length === 0 && (
              <View style={styles.watermarkContainer} pointerEvents="none">
                <Text style={styles.watermarkText}>DRAW OR WRITE FREELY</Text>
              </View>
            )}

            {/* Vector strokes rendering via SVG on Web, or pure segments on RN */}
            {Platform.OS === 'web' ? (
              <svg
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              >
                {strokes.map((stroke, idx) => (
                  <path
                    key={`stroke-${idx}`}
                    d={pointsToSvgPath(stroke.points)}
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                ))}
                {currentStroke.length > 0 && (
                  <path
                    d={pointsToSvgPath(currentStroke)}
                    stroke={selectedColor}
                    strokeWidth={selectedWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                )}
              </svg>
            ) : (
              // Native rendering: simulated stroke lines
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {strokes.map((stroke, sIdx) => {
                  if (stroke.points.length === 1) {
                    const pt = stroke.points[0];
                    return (
                      <View
                        key={`s-${sIdx}-dot`}
                        style={{
                          position: 'absolute',
                          left: pt.x - stroke.width / 2,
                          top: pt.y - stroke.width / 2,
                          width: stroke.width,
                          height: stroke.width,
                          borderRadius: stroke.width / 2,
                          backgroundColor: stroke.color,
                        }}
                      />
                    );
                  }
                  return stroke.points.map((pt, pIdx) => {
                    if (pIdx === 0) return null;
                    const prev = stroke.points[pIdx - 1];
                    const dx = pt.x - prev.x;
                    const dy = pt.y - prev.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                    return (
                      <View
                        key={`s-${sIdx}-p-${pIdx}`}
                        style={{
                          position: 'absolute',
                          left: prev.x,
                          top: prev.y,
                          width: length,
                          height: stroke.width,
                          backgroundColor: stroke.color,
                          borderRadius: stroke.width / 2,
                          transformOrigin: '0% 50%',
                          transform: [{ rotate: `${angle}deg` }],
                        }}
                      />
                    );
                  });
                })}
                {currentStroke.length === 1 ? (
                  <View
                    key="curr-dot"
                    style={{
                      position: 'absolute',
                      left: currentStroke[0].x - selectedWidth / 2,
                      top: currentStroke[0].y - selectedWidth / 2,
                      width: selectedWidth,
                      height: selectedWidth,
                      borderRadius: selectedWidth / 2,
                      backgroundColor: selectedColor,
                    }}
                  />
                ) : (
                  currentStroke.map((pt, pIdx) => {
                    if (pIdx === 0) return null;
                    const prev = currentStroke[pIdx - 1];
                    const dx = pt.x - prev.x;
                    const dy = pt.y - prev.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                    return (
                      <View
                        key={`curr-${pIdx}`}
                        style={{
                          position: 'absolute',
                          left: prev.x,
                          top: prev.y,
                          width: length,
                          height: selectedWidth,
                          backgroundColor: selectedColor,
                          borderRadius: selectedWidth / 2,
                          transformOrigin: '0% 50%',
                          transform: [{ rotate: `${angle}deg` }],
                        }}
                      />
                    );
                  })
                )}
              </View>
            )}
          </View>

          {/* Palette & Stroke Width Toolbar */}
          <View style={styles.toolbarRow}>
            {/* Colors */}
            <View style={styles.colorPalette}>
              {PALETTE.map((item) => {
                const isActive = selectedColor === item.color;
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => setSelectedColor(item.color)}
                    style={[
                      styles.colorCircle,
                      { backgroundColor: item.color },
                      isActive && styles.colorCircleActive,
                    ]}
                    testID={`color-btn-${item.id}`}
                    accessibilityLabel={item.label}
                  />
                );
              })}
            </View>

            {/* Stroke Widths */}
            <View style={styles.widthPalette}>
              {WIDTHS.map((w) => {
                const isActive = selectedWidth === w.width;
                return (
                  <TouchableOpacity
                    key={w.id}
                    onPress={() => setSelectedWidth(w.width)}
                    style={[
                      styles.widthChip,
                      isActive && styles.widthChipActive,
                    ]}
                    testID={`width-btn-${w.id}`}
                  >
                    <Text
                      style={[
                        styles.widthChipText,
                        isActive && styles.widthChipTextActive,
                      ]}
                    >
                      {w.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Action Buttons: Undo & Clear */}
            <View style={styles.actionTools}>
              <TouchableOpacity
                onPress={handleUndo}
                style={styles.toolBtn}
                disabled={strokes.length === 0}
                testID="canvas-undo-btn"
              >
                <Text
                  style={[
                    styles.toolBtnText,
                    strokes.length === 0 && styles.toolBtnTextDisabled,
                  ]}
                >
                  UNDO
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClear}
                style={styles.toolBtn}
                disabled={strokes.length === 0 && currentStroke.length === 0}
                testID="canvas-clear-btn"
              >
                <Text
                  style={[
                    styles.toolBtnText,
                    strokes.length === 0 && currentStroke.length === 0 && styles.toolBtnTextDisabled,
                  ]}
                >
                  CLEAR
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom Action Footer */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.cancelBtn}
              testID="canvas-cancel-btn"
            >
              <Text style={styles.cancelBtnText}>DISCARD</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSave}
              style={[
                styles.saveBtn,
                (strokes.length === 0 && currentStroke.length === 0) && styles.saveBtnDisabled,
              ]}
              disabled={isSaving || (strokes.length === 0 && currentStroke.length === 0)}
              testID="canvas-save-btn"
            >
              <Text style={styles.saveBtnText}>
                {isSaving ? 'SAVING…' : 'ATTACH INK CARD'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 0,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerTitle: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#888888',
  },
  titleInput: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  presetsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#0D0D0D',
  },
  presetChipSelected: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  presetChipText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#888888',
  },
  presetChipTextSelected: {
    color: '#000000',
  },
  canvasWrapper: {
    width: '100%',
    height: 240,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#262626',
    position: 'relative',
    overflow: 'hidden',
  },
  watermarkContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  watermarkText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    color: '#222222',
    fontWeight: '700',
  },
  toolbarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  colorPalette: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorCircleActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.2 }],
  },
  widthPalette: {
    flexDirection: 'row',
    gap: 4,
  },
  widthChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#0D0D0D',
  },
  widthChipActive: {
    borderColor: '#FFFFFF',
    backgroundColor: '#262626',
  },
  widthChipText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#888888',
  },
  widthChipTextActive: {
    color: '#FFFFFF',
  },
  actionTools: {
    flexDirection: 'row',
    gap: 6,
  },
  toolBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#262626',
    backgroundColor: '#0D0D0D',
  },
  toolBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#B0B0B0',
  },
  toolBtnTextDisabled: {
    color: '#444444',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: '#777777',
    letterSpacing: 1,
  },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  saveBtnDisabled: {
    backgroundColor: '#333333',
    borderColor: '#333333',
  },
  saveBtnText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 1,
  },
});
