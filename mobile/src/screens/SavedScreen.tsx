import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, shadow, space, type } from '../theme/tokens';
import type { App } from '../state';
import { Button, EmptyCard, Header } from '../components/primitives';

import { urgencyOf, type Urgency } from '../logic/feed';

/** Urgency drives the card's left border and its days-left badge. */
const URGENCY_COLOR: Record<Urgency, string> = {
  closing: color.red,
  soon: color.amber,
  later: color.accent,
  open: color.accent
};

export function SavedScreen(app: App) {
  return (
    <View style={styles.screen}>
      <Header title="Saved & deadlines" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.padded, styles.stack]}>
          {app.savedJobs.length === 0 ? (
            <EmptyCard
              title="Nothing saved yet"
              body="Save a role from the feed and its deadline shows up here."
            />
          ) : (
            app.savedJobs.map((job) => {
              const tint = URGENCY_COLOR[urgencyOf(job.days)];
              return (
                <View key={job.id} style={[styles.card, { borderLeftColor: tint }]}>
                  <View style={styles.head}>
                    <View style={styles.headText}>
                      <Text style={styles.role}>{job.role}</Text>
                      <Text style={styles.firm}>
                        {job.firm} · {job.city}
                      </Text>
                    </View>
                    {job.days !== null ? (
                      <View style={[styles.badge, { backgroundColor: tint }]}>
                        <Text style={styles.badgeText}>{job.days}d</Text>
                      </View>
                    ) : null}
                  </View>

                  {job.deadline ? (
                    <Text style={styles.deadline}>Closes {job.deadline}</Text>
                  ) : null}

                  <View style={styles.actions}>
                    <Button
                      label="Mark applied"
                      tone="accent"
                      onPress={() => app.apply(job.id)}
                    />
                    <Button label="Remove" onPress={() => app.removeSaved(job.id)} />
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.scrollBottom },
  padded: { paddingHorizontal: space.screen },
  stack: { gap: space.gap },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.card,
    borderWidth: 1,
    borderColor: color.hairline,
    borderLeftWidth: 3,
    ...shadow.card
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headText: { flex: 1 },
  role: { ...type.cardTitle },
  firm: { ...type.cardSubtitle, marginTop: 3 },

  badge: { borderRadius: radius.tag, paddingHorizontal: 7, paddingVertical: 4 },
  badgeText: { fontFamily: 'JetBrainsMono_700Bold', fontSize: 10, color: color.surface },

  deadline: { ...type.metaTag, marginTop: 11 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 13 }
});
