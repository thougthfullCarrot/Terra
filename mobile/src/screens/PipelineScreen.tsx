import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, stageColor, type } from '../theme/tokens';
import { STAGES, type App } from '../state';
import { Button, Card, EmptyCard, Header } from '../components/primitives';
import type { Stage } from '../data/types';

/** Where a card's button sends it next. An Offer is the end of the line. */
const NEXT: Record<Stage, Stage | null> = {
  Applied: 'Interview',
  Interview: 'Offer',
  Offer: null
};

export function PipelineScreen(app: App) {
  const applications = Object.entries(app.apps);
  const counts = {
    Saved: Object.keys(app.saved).length,
    Applied: applications.filter(([, a]) => a.stage === 'Applied').length,
    Interview: applications.filter(([, a]) => a.stage === 'Interview').length,
    Offer: applications.filter(([, a]) => a.stage === 'Offer').length
  };

  const groups = STAGES.map((stage) => ({
    stage,
    items: app.jobs.filter((job) => app.apps[job.id]?.stage === stage)
  })).filter((group) => group.items.length > 0);

  return (
    <View style={styles.screen}>
      <Header title="Pipeline" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.padded, styles.counters]}>
          {(['Saved', 'Applied', 'Interview', 'Offer'] as const).map((label) => (
            <View key={label} style={styles.counter}>
              <Text style={styles.counterValue}>{counts[label]}</Text>
              <Text style={styles.counterLabel}>{label.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.padded, styles.stack]}>
          {groups.length === 0 ? (
            <EmptyCard
              title="Nothing in the pipeline"
              body="Apply from a posting and it shows up here."
            />
          ) : (
            groups.map(({ stage, items }) => (
              <View key={stage} style={styles.group}>
                <View style={styles.groupHead}>
                  <View style={[styles.dot, { backgroundColor: stageColor[stage] }]} />
                  <Text style={styles.groupLabel}>{stage.toUpperCase()}</Text>
                  <View style={styles.rule} />
                  <Text style={styles.groupCount}>{items.length}</Text>
                </View>

                {items.map((job) => {
                  const next = NEXT[stage];
                  return (
                    <Card key={job.id} style={styles.card}>
                      <Text style={styles.role}>{job.role}</Text>
                      <Text style={styles.firm}>
                        {job.firm} · {job.city}
                      </Text>
                      <Text style={styles.note}>{app.apps[job.id]?.note}</Text>
                      {next ? (
                        <View style={styles.action}>
                          <Button label={`Move to ${next}`} onPress={() => app.advance(job.id)} />
                        </View>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.scrollBottom, gap: space.gap },
  padded: { paddingHorizontal: space.screen },
  stack: { gap: 18 },

  counters: { flexDirection: 'row', gap: 7 },
  counter: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingVertical: 12,
    alignItems: 'center'
  },
  counterValue: { ...type.bigStat },
  counterLabel: { ...type.sectionLabel, fontSize: 8.5, marginTop: 5, marginBottom: 0 },

  group: { gap: space.gap },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  groupLabel: { ...type.sectionLabel, marginBottom: 0 },
  rule: { flex: 1, height: 1, backgroundColor: color.hairline },
  groupCount: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 10, color: color.faint },

  card: { gap: 3 },
  role: { ...type.cardTitle },
  firm: { ...type.cardSubtitle },
  note: { ...type.cardSubtitle, color: color.faint, marginTop: 5 },
  action: { marginTop: 12, alignItems: 'flex-start' }
});
