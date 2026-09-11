import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, type } from '../theme/tokens';
import type { Tab } from '../state';

/**
 * The handoff ships no icon set — every indicator is a CSS shape — so each tab
 * gets a small geometric mark built from views rather than a glyph font.
 */
const TABS: { key: Tab; label: string }[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'market', label: 'Market' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'saved', label: 'Saved' },
  { key: 'profile', label: 'Profile' }
];

export function TabBar({ tab, onPick }: { tab: Tab; onPick: (tab: Tab) => void }) {
  return (
    <View style={styles.bar}>
      {TABS.map(({ key, label }) => {
        const active = key === tab;
        const tint = active ? color.accent : color.disabled;
        return (
          <Pressable
            key={key}
            onPress={() => onPick(key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Mark tab={key} tint={tint} />
            <Text style={[styles.label, { color: tint }, active && styles.labelActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Mark({ tab, tint }: { tab: Tab; tint: string }) {
  switch (tab) {
    case 'feed':
      // Three stacked rules, like a list of cards.
      return (
        <View style={styles.mark}>
          {[10, 14, 10].map((width, index) => (
            <View key={index} style={[styles.rule, { width, backgroundColor: tint }]} />
          ))}
        </View>
      );
    case 'market':
      // A rising bar chart.
      return (
        <View style={[styles.mark, styles.markRow]}>
          {[5, 9, 13].map((height, index) => (
            <View key={index} style={[styles.chartBar, { height, backgroundColor: tint }]} />
          ))}
        </View>
      );
    case 'pipeline':
      // Three dots in a column: the three stages.
      return (
        <View style={styles.mark}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={[styles.dot, { backgroundColor: tint }]} />
          ))}
        </View>
      );
    case 'saved':
      // A bookmark: a square with a notch cut from the bottom.
      return (
        <View style={styles.mark}>
          <View style={[styles.bookmark, { borderColor: tint }]}>
            <View style={[styles.notch, { borderBottomColor: color.bg }]} />
          </View>
        </View>
      );
    case 'profile':
      // A head and shoulders.
      return (
        <View style={styles.mark}>
          <View style={[styles.head, { backgroundColor: tint }]} />
          <View style={[styles.shoulders, { backgroundColor: tint }]} />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderTopColor: color.hairline,
    paddingTop: 10,
    paddingBottom: 26
  },
  tab: { flex: 1, alignItems: 'center', gap: 6 },

  mark: { height: 15, alignItems: 'center', justifyContent: 'center', gap: 2.5 },
  markRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },

  rule: { height: 1.5, borderRadius: 1 },
  chartBar: { width: 3, borderRadius: 1 },
  dot: { width: 3.5, height: 3.5, borderRadius: 2 },

  bookmark: {
    width: 11,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 2,
    overflow: 'hidden',
    justifyContent: 'flex-end'
  },
  notch: {
    alignSelf: 'center',
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent'
  },

  head: { width: 5.5, height: 5.5, borderRadius: 3 },
  shoulders: { width: 11, height: 6, borderTopLeftRadius: 6, borderTopRightRadius: 6 },

  label: { ...type.tabLabel },
  labelActive: { fontFamily: 'Archivo_600SemiBold' }
});
