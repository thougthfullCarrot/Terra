import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';
import { MARKET_CITIES, type App } from '../state';
import { Button, Card, ChipRow, Header, SectionLabel } from '../components/primitives';

/** Delta text takes its color from the direction the stat moved. */
const DELTA_COLOR: Record<string, string> = {
  up: color.accent,
  down: color.red,
  flat: color.muted
};

export function MarketScreen(app: App) {
  const market = app.markets[app.mktCity] ?? app.markets.Texas;
  if (!market) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <Header eyebrow="Q3 2026 · Texas" title="Market pulse" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* No selection means the statewide roll-up; re-tapping returns to it. */}
        <ChipRow options={MARKET_CITIES} value={app.mktCity} onPick={app.pickMarketCity} />

        <View style={[styles.padded, styles.stack]}>
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <Text style={styles.panelCity}>
                {app.mktCity === 'Texas' ? 'Texas · all markets' : app.mktCity}
              </Text>
              <View style={styles.trend}>
                <Text style={styles.trendText}>{market.trend}</Text>
              </View>
            </View>
            <Text style={styles.panelBody}>{market.summary}</Text>
          </View>

          <View style={styles.grid}>
            {market.stats.map(([label, value, delta, dir]) => (
              <View key={label} style={styles.tile}>
                <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
                <Text style={styles.tileValue}>{value}</Text>
                <Text style={[styles.tileDelta, { color: DELTA_COLOR[dir] ?? color.muted }]}>
                  {delta}
                </Text>
              </View>
            ))}
          </View>

          <Card>
            <SectionLabel>Sector activity</SectionLabel>
            <View style={styles.sectors}>
              {market.sectors.map(([name, note, pct]) => (
                <View key={name}>
                  <View style={styles.sectorRow}>
                    <Text style={styles.sectorName}>{name}</Text>
                    <Text style={styles.sectorNote}>{note}</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${pct}%` }]} />
                  </View>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <SectionLabel>What moved this week</SectionLabel>
            <View style={styles.news}>
              {market.news.map(([tag, head, body], index) => (
                <View
                  key={head}
                  style={[styles.newsItem, index > 0 && styles.newsItemDivided]}
                >
                  <Text style={styles.newsTag}>{tag.toUpperCase()}</Text>
                  <Text style={styles.newsHead}>{head}</Text>
                  <Text style={styles.newsBody}>{body}</Text>
                </View>
              ))}
            </View>
          </Card>

          <View style={styles.hiring}>
            <SectionLabel>Hiring read</SectionLabel>
            <Text style={styles.hiringBody}>{market.hiring}</Text>
            <View style={styles.hiringAction}>
              <Button
                label={app.mktCity === 'Texas' ? 'See all Texas roles' : `See ${app.mktCity} roles`}
                tone="accent"
                onPress={() => app.seeJobsIn(app.mktCity)}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.scrollBottom, gap: space.gap },
  padded: { paddingHorizontal: space.screen },
  stack: { gap: space.gap },

  panel: { backgroundColor: color.panel, borderRadius: radius.card, padding: space.card },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  panelCity: { fontFamily: 'Archivo_600SemiBold', fontSize: 15, color: color.surface },
  trend: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.tag,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  trendText: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 9.5,
    letterSpacing: 0.7,
    color: color.panelBody
  },
  panelBody: { ...type.body, color: color.panelBody },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
  tile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: color.surface,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: 13
  },
  tileLabel: { ...type.sectionLabel, fontSize: 9, marginBottom: 7 },
  tileValue: { ...type.bigStat },
  tileDelta: { fontFamily: 'JetBrainsMono_500Medium', fontSize: 10.5, marginTop: 5 },

  sectors: { gap: 12 },
  sectorRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  sectorName: { fontFamily: 'Archivo_500Medium', fontSize: 13, color: color.ink },
  sectorNote: { ...type.cardSubtitle, fontSize: 11.5 },
  track: { height: 6, borderRadius: 4, backgroundColor: color.chipAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: color.accent },

  news: { gap: 12 },
  newsItem: { gap: 4 },
  newsItemDivided: { borderTopWidth: 1, borderTopColor: color.divider, paddingTop: 12 },
  newsTag: { ...type.metaTag, color: color.accent },
  newsHead: { fontFamily: 'Archivo_600SemiBold', fontSize: 13.5, lineHeight: 18, color: color.ink },
  newsBody: { ...type.cardSubtitle },

  hiring: { backgroundColor: color.accentTint, borderRadius: radius.card, padding: space.card },
  hiringBody: { ...type.body, color: color.onTint },
  hiringAction: { marginTop: 13 }
});
