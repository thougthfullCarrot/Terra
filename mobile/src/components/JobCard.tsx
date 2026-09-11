import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, shadow, space, type } from '../theme/tokens';
import type { MatchEntry, Posting } from '../data/types';
import { MetaTag } from './primitives';

/**
 * A feed card. When the posting is a strong match it gains a navy header line,
 * a navy border, and the two-layer shadow from the handoff — the CSS
 * `0 2px 0 #2B4A8B` underline is a bottom border here, since RN has no
 * multiple box-shadow.
 */
export function JobCard({
  job,
  match,
  strong,
  saved,
  onOpen,
  onToggleSave
}: {
  job: Posting;
  match?: MatchEntry;
  strong: boolean;
  saved: boolean;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      <View style={[styles.card, strong && styles.cardStrong]}>
        {strong && match ? (
          <View style={styles.matchLine}>
            <Text style={styles.matchScore}>RESUME MATCH {match.score}%</Text>
            {match.note ? <Text style={styles.matchNote}>{match.note}</Text> : null}
          </View>
        ) : null}

        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={styles.role}>{job.role}</Text>
            <Text style={styles.firm}>{job.firm}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{job.kind === 'Internship' ? 'INTERN' : 'ENTRY'}</Text>
          </View>
        </View>

        <View style={styles.tags}>
          <MetaTag label={job.city} />
          <MetaTag label={job.sector} />
          {job.pay ? <MetaTag label={job.pay} /> : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Posted {job.posted === 0 ? 'today' : `${job.posted} day${job.posted === 1 ? '' : 's'} ago`}
            {job.days !== null ? ` · closes in ${job.days}d` : ''}
          </Text>
          <Pressable
            onPress={onToggleSave}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: saved }}
          >
            <Text style={[styles.save, saved && styles.saveOn]}>{saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.card,
    borderWidth: 1,
    borderColor: color.hairline,
    ...shadow.card
  },
  cardStrong: {
    borderColor: color.accent,
    borderBottomWidth: 2,
    borderBottomColor: color.accent,
    ...shadow.strong
  },
  pressed: { opacity: 0.7 },

  matchLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  matchScore: { fontFamily: 'JetBrainsMono_700Bold', fontSize: 9.5, letterSpacing: 0.7, color: color.accent },
  matchNote: { ...type.cardSubtitle, fontSize: 11.5, flexShrink: 1 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleText: { flex: 1 },
  role: { ...type.cardTitle },
  firm: { ...type.cardSubtitle, marginTop: 3 },

  badge: {
    backgroundColor: color.chipAlt,
    borderRadius: radius.tag,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  badgeText: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 9, letterSpacing: 0.7, color: color.secondary },

  tags: { flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 13,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: color.divider
  },
  footerText: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 9.5, color: color.faint, flexShrink: 1 },
  save: { fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: color.muted },
  saveOn: { color: color.accent }
});
