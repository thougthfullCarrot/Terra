import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';
import { CITIES, TYPES, type App } from '../state';
import { ChipRow, EmptyCard, Header, Segmented } from '../components/primitives';
import { JobCard } from '../components/JobCard';
import { ErrorState, LoadingState } from '../components/states';

const TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

export function FeedScreen(app: App) {
  return (
    <View style={styles.screen}>
      <Header
        eyebrow="Texas · CRE"
        title="Open roles"
        trailing={
          app.status === 'ready' ? (
            <Text style={styles.count}>{app.strongCount} matches</Text>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {app.status === 'loading' ? <LoadingState /> : null}

        {app.status === 'error' ? (
          <ErrorState message={app.error ?? 'Source unreachable'} onRetry={app.load} />
        ) : null}

        {app.status === 'ready' ? (
          <>
            <View style={styles.padded}>
              <Segmented options={TYPES} value={app.type} onPick={app.pickType} />
            </View>

            <ChipRow options={CITIES} value={app.city} onPick={app.pickCity} />

            {app.strongCount > 0 ? (
              <View style={styles.padded}>
                <View style={styles.matchBar}>
                  <Text style={styles.matchBarText}>
                    {app.strongCount} role{app.strongCount === 1 ? '' : 's'} match your resume
                    almost exactly
                  </Text>
                  <Pressable onPress={() => app.setMatchOnly(!app.matchOnly)} hitSlop={8}>
                    <Text style={styles.matchBarAction}>
                      {app.matchOnly ? 'Show all' : 'Show only'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={[styles.padded, styles.cards]}>
              {app.feed.length === 0 ? (
                <EmptyCard
                  title="No postings match"
                  body="Clear a filter, or re-tap the active chip to go back to all of Texas."
                />
              ) : (
                app.feed.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    match={app.matchIndex[job.id]}
                    strong={app.isStrong(job.id)}
                    saved={Boolean(app.saved[job.id])}
                    onOpen={() => app.setDetail(job.id)}
                    onToggleSave={() => app.toggleSave(job.id)}
                  />
                ))
              )}
            </View>

            <View style={styles.padded}>
              <Pressable onPress={app.load} style={styles.sync}>
                <Text style={styles.syncText}>
                  Synced {app.lastSync ? TIME.format(app.lastSync) : '—'} CT · tap to refresh
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.scrollBottom, gap: space.gap },
  padded: { paddingHorizontal: space.screen },
  cards: { gap: space.gap },

  count: { fontFamily: 'JetBrainsMono_700Bold', fontSize: 11, color: color.accent, paddingBottom: 4 },

  matchBar: {
    backgroundColor: color.accentTint,
    borderRadius: radius.inner,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  matchBarText: { ...type.cardSubtitle, color: color.onTint, flexShrink: 1, fontSize: 12.5 },
  matchBarAction: { fontFamily: 'Archivo_600SemiBold', fontSize: 12, color: color.accent },

  sync: { alignItems: 'center', paddingVertical: 12 },
  syncText: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 10, color: color.faint }
});
