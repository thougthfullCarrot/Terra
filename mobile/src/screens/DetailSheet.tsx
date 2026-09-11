import { useEffect, useRef } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';
import type { App } from '../state';
import { Button, MetaTag, SectionLabel } from '../components/primitives';

/**
 * Pushes over the current screen rather than replacing it: it sits above the
 * content and below the device status bar, and the tab bar hides while it is
 * open (the shell stops rendering it). Entry is translateY(18) + fade over
 * 220ms ease-out.
 */
export function DetailSheet({ app, id }: { app: App; id: string }) {
  const job = app.jobs.find((candidate) => candidate.id === id);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [enter]);

  if (!job) return null;

  const match = app.matchIndex[job.id];
  const strong = app.isStrong(job.id);
  const application = app.apps[job.id];
  const saved = Boolean(app.saved[job.id]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }]
        }
      ]}
    >
      <View style={styles.head}>
        <Pressable onPress={() => app.setDetail(null)} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.role}>{job.role}</Text>
        <Text style={styles.firm}>
          {job.firm} · {job.city}
        </Text>
        <View style={styles.tags}>
          <MetaTag label={job.kind === 'Internship' ? 'Intern' : 'Entry'} />
          <MetaTag label={job.sector} />
          {job.pay ? <MetaTag label={job.pay} /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>DEADLINE</Text>
            <Text style={styles.tileValue}>{job.deadline ?? 'Open'}</Text>
            {job.days !== null ? (
              <Text style={styles.tileNote}>{job.days} days left</Text>
            ) : null}
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>POSTED</Text>
            <Text style={styles.tileValue}>
              {job.posted === 0 ? 'Today' : `${job.posted}d ago`}
            </Text>
          </View>
        </View>

        {strong && match ? (
          <View style={styles.matchPanel}>
            <Text style={styles.matchScore}>RESUME MATCH {match.score}%</Text>
            {match.lines.map((line) => (
              <View key={line} style={styles.matchLine}>
                <View style={styles.bullet} />
                <Text style={styles.matchText}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View>
          <SectionLabel>The role</SectionLabel>
          <Text style={styles.prose}>{job.desc}</Text>
        </View>

        {job.reqs.length ? (
          <View>
            <SectionLabel>What they want</SectionLabel>
            {job.reqs.map((req) => (
              <View key={req} style={styles.reqRow}>
                <View style={styles.reqBullet} />
                <Text style={styles.reqText}>{req}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.provenance}>{job.source}</Text>
      </ScrollView>

      <View style={styles.bar}>
        <View style={styles.barSave}>
          <Button
            label={saved ? 'Saved' : 'Save'}
            onPress={() => app.toggleSave(job.id)}
          />
        </View>
        <View style={styles.barApply}>
          <Button
            label={application ? `In pipeline · ${application.stage}` : 'Apply with saved resume'}
            tone="accent"
            disabled={Boolean(application)}
            onPress={() => app.apply(job.id)}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Below the device status bar, above the screen it covers.
    zIndex: 5,
    backgroundColor: color.bg
  },

  head: {
    backgroundColor: color.surface,
    paddingTop: space.headerTop,
    paddingHorizontal: space.screen,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: color.hairline
  },
  back: { alignSelf: 'flex-start', paddingBottom: 14 },
  backText: { fontFamily: 'Archivo_500Medium', fontSize: 13, color: color.muted },
  role: { fontFamily: 'Archivo_700Bold', fontSize: 22, lineHeight: 26, color: color.ink },
  firm: { ...type.cardSubtitle, marginTop: 5 },
  tags: { flexDirection: 'row', gap: 6, marginTop: 13, flexWrap: 'wrap' },

  body: { padding: space.screen, paddingBottom: 120, gap: 20 },

  tiles: { flexDirection: 'row', gap: space.gap },
  tile: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: 13
  },
  tileLabel: { ...type.sectionLabel, fontSize: 9, marginBottom: 7 },
  tileValue: { fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: color.ink },
  tileNote: { ...type.metaTag, marginTop: 5 },

  matchPanel: { backgroundColor: color.accentTint, borderRadius: radius.card, padding: space.card },
  matchScore: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: color.accent,
    marginBottom: 11
  },
  matchLine: { flexDirection: 'row', gap: 9, marginTop: 8 },
  bullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.accent, marginTop: 7 },
  matchText: { ...type.body, fontSize: 13, color: color.onTint, flex: 1 },

  prose: { ...type.body },

  reqRow: { flexDirection: 'row', gap: 9, marginTop: 7 },
  reqBullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.faint, marginTop: 8 },
  reqText: { ...type.body, flex: 1 },

  provenance: { ...type.cardSubtitle, fontSize: 11.5, color: color.faint },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    padding: space.screen,
    paddingBottom: 30,
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.hairline
  },
  barSave: { width: 96 },
  barApply: { flex: 1 }
});
