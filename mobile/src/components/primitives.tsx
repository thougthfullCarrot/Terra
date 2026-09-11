import { type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { color, radius, shadow, space, type } from '../theme/tokens';

/** Screen header: mono eyebrow over the big Archivo title, with optional trailing content. */
export function Header({
  eyebrow,
  title,
  trailing
}: {
  eyebrow?: string;
  title: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {trailing}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {content}
    </Pressable>
  );
}

/** Dashed placeholder used by both empty states. */
export function EmptyCard({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

/** Uppercase mono tag: city, sector, pay. */
export function MetaTag({ label }: { label: string }) {
  return (
    <View style={styles.metaTag}>
      <Text style={styles.metaTagText}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children.toUpperCase()}</Text>;
}

export function Button({
  label,
  onPress,
  tone = 'default',
  disabled
}: {
  label: string;
  onPress?: () => void;
  tone?: 'default' | 'accent' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'accent' && styles.buttonAccent,
        tone === 'quiet' && styles.buttonQuiet,
        disabled && styles.buttonDisabled,
        pressed && !disabled ? styles.pressed : null
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          tone === 'accent' && styles.buttonLabelAccent,
          disabled && styles.buttonLabelDisabled
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The segmented control on the Feed. The active pill is white on the track,
 * and re-tapping it clears the filter — that behaviour lives in the state hook.
 */
export function Segmented({
  options,
  value,
  onPick
}: {
  options: readonly string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onPick(option)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Horizontally scrolling city chips. They deliberately bleed past the screen's
 * 18pt side padding, so this sits outside the padded column and pads itself.
 */
export function ChipRow({
  options,
  value,
  onPick
}: {
  options: readonly string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onPick(option)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Toggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={[styles.toggle, on && styles.toggleOn]}
    >
      <View style={[styles.knob, on && styles.knobOn]} />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: space.headerTop,
    paddingHorizontal: space.screen,
    paddingBottom: 14
  },
  headerText: { flex: 1 },
  eyebrow: { ...type.eyebrow, marginBottom: 7 },
  title: { ...type.screenTitle },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.card,
    borderWidth: 1,
    borderColor: color.hairline,
    ...shadow.card
  },
  pressed: { opacity: 0.7 },

  empty: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.hairline,
    padding: 22,
    alignItems: 'center'
  },
  emptyTitle: { ...type.cardTitle, color: color.muted },
  emptyBody: { ...type.cardSubtitle, marginTop: 6, textAlign: 'center' },

  metaTag: {
    backgroundColor: color.chip,
    borderRadius: radius.tag,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  metaTagText: { ...type.metaTag },

  sectionLabel: { ...type.sectionLabel, marginBottom: 9 },

  button: {
    borderRadius: radius.button,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    backgroundColor: color.chip,
    borderWidth: 1,
    borderColor: color.hairline
  },
  buttonAccent: { backgroundColor: color.accent, borderColor: color.accent },
  buttonQuiet: { backgroundColor: 'transparent' },
  buttonDisabled: { backgroundColor: color.chipAlt, borderColor: color.divider },
  buttonLabel: { fontFamily: 'Archivo_600SemiBold', fontSize: 13, color: color.ink },
  buttonLabelAccent: { color: color.surface },
  buttonLabelDisabled: { color: color.disabled },

  segmented: {
    flexDirection: 'row',
    backgroundColor: color.track,
    borderRadius: radius.pill,
    padding: 3
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.pill,
    alignItems: 'center'
  },
  segmentActive: { backgroundColor: color.surface, ...shadow.card },
  segmentLabel: { fontFamily: 'Archivo_500Medium', fontSize: 12.5, color: color.muted },
  segmentLabelActive: { fontFamily: 'Archivo_600SemiBold', color: color.ink },

  chipRow: { paddingHorizontal: space.screen, gap: 7, paddingVertical: 2 },
  chip: {
    backgroundColor: color.chip,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color.hairline
  },
  chipActive: { backgroundColor: color.accent, borderColor: color.accent },
  chipLabel: { fontFamily: 'Archivo_500Medium', fontSize: 12.5, color: color.secondary },
  chipLabelActive: { color: color.surface },

  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.toggleOff,
    padding: 3,
    justifyContent: 'center'
  },
  toggleOn: { backgroundColor: color.accent },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.surface
  },
  knobOn: { alignSelf: 'flex-end' }
});
