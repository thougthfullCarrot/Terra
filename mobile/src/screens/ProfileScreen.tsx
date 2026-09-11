import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';
import type { App, Prefs } from '../state';
import { Button, Card, Header, SectionLabel, Toggle } from '../components/primitives';

const PREFS: { key: keyof Prefs; label: string; note: string }[] = [
  { key: 'digest', label: 'Daily Texas digest', note: 'New CRE postings, 8am CT' },
  { key: 'deadlines', label: 'Deadline reminders', note: '3 days before a saved role closes' },
  { key: 'internsOnly', label: 'Internships only', note: 'Hide entry-level full-time' },
  { key: 'market', label: 'Weekly market note', note: 'DFW, Houston, Austin fundamentals' }
];

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

export function ProfileScreen(app: App) {
  return (
    <View style={styles.screen}>
      <Header title="Your profile" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.padded, styles.stack]}>
          <Card>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.initials}>MR</Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name}>Maya Reyes</Text>
                <Text style={styles.school}>UT Austin · Finance, May 2027</Text>
              </View>
            </View>
          </Card>

          <Card>
            <SectionLabel>Alert preferences</SectionLabel>
            <View style={styles.prefs}>
              {PREFS.map(({ key, label, note }, index) => (
                <View key={key} style={[styles.pref, index > 0 && styles.prefDivided]}>
                  <View style={styles.prefText}>
                    <Text style={styles.prefLabel}>{label}</Text>
                    <Text style={styles.prefNote}>{note}</Text>
                  </View>
                  <Toggle on={app.prefs[key]} onPress={() => app.togglePref(key)} />
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <SectionLabel>Resume</SectionLabel>
            <Text style={styles.resume}>Reyes_Maya_CRE_2026.pdf</Text>
            <Text style={styles.resumeNote}>
              Match scores are computed against this file server side.
            </Text>
          </Card>

          <Card>
            <SectionLabel>Data source</SectionLabel>
            <View style={styles.rows}>
              <Row label="Source" value={app.source.name} />
              <Row label="Endpoint" value={app.source.endpoint} />
              <Row label="Polling" value={app.source.poll} />
              <Row
                label="Last sync"
                value={app.lastSync ? `${TIME.format(app.lastSync)} CT` : '—'}
              />
            </View>
            <View style={styles.actions}>
              <Button label="Sync now" tone="accent" onPress={app.load} />
              {/* Dev affordance from the handoff: forces the error state. */}
              <Button label="Test failure" onPress={app.breakSource} />
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.scrollBottom },
  padded: { paddingHorizontal: space.screen },
  stack: { gap: space.gap },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.accentTint,
    alignItems: 'center',
    justifyContent: 'center'
  },
  initials: { fontFamily: 'Archivo_700Bold', fontSize: 15, color: color.accent },
  identityText: { flex: 1 },
  name: { fontFamily: 'Archivo_700Bold', fontSize: 18, color: color.ink },
  school: { ...type.cardSubtitle, marginTop: 3 },

  prefs: { gap: 0 },
  pref: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  prefDivided: { borderTopWidth: 1, borderTopColor: color.divider },
  prefText: { flex: 1 },
  prefLabel: { fontFamily: 'Archivo_500Medium', fontSize: 13.5, color: color.ink },
  prefNote: { ...type.cardSubtitle, fontSize: 11.5, marginTop: 2 },

  resume: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 12, color: color.ink },
  resumeNote: { ...type.cardSubtitle, fontSize: 11.5, marginTop: 6 },

  rows: { gap: 9 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowLabel: { ...type.sectionLabel, fontSize: 9, marginBottom: 0, width: 74 },
  rowValue: { ...type.cardSubtitle, fontSize: 11.5, color: color.secondary, flex: 1 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 15 }
});
