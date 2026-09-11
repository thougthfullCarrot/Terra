import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';
import { Button } from './primitives';

/**
 * Loading: the header renders immediately, then a pulsing dot and four
 * shimmering skeleton cards. Opacity 1 -> .45 over 1.3s, staggered 150ms.
 */
export function Pulse({ delay = 0, style }: { delay?: number; style?: object }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 650, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, opacity]);

  return <Animated.View style={[style, { opacity }]} />;
}

export function LoadingState() {
  return (
    <View style={styles.wrap}>
      <View style={styles.pollingRow}>
        <Pulse style={styles.dot} />
        <Text style={styles.pollingText}>Pulling Texas postings…</Text>
      </View>

      {[0, 1, 2, 3].map((index) => (
        <Pulse key={index} delay={index * 150} style={styles.skeleton} />
      ))}
    </View>
  );
}

/**
 * Error: the thrown message is shown as thrown, plus the reassurance that the
 * two cached screens still work.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.errorCard}>
        <Text style={styles.errorLabel}>FEED UNAVAILABLE</Text>
        <Text style={styles.errorMessage}>{message}</Text>
        <Text style={styles.errorNote}>
          Saved roles and your pipeline are cached and still available.
        </Text>
        <View style={styles.errorAction}>
          <Button label="Try again" onPress={onRetry} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.screen, gap: space.gap },

  pollingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.accent },
  pollingText: { ...type.cardSubtitle, fontSize: 12.5 },

  skeleton: {
    height: 118,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.hairline
  },

  errorCard: {
    backgroundColor: color.errorSurface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(184,68,46,0.25)',
    padding: space.card
  },
  errorLabel: {
    fontFamily: 'JetBrainsMono_700Bold',
    fontSize: 9.5,
    letterSpacing: 0.9,
    color: color.red
  },
  errorMessage: { ...type.body, color: color.errorInk, marginTop: 9 },
  errorNote: { ...type.cardSubtitle, color: color.errorInk, opacity: 0.75, marginTop: 8 },
  errorAction: { marginTop: 13, alignItems: 'flex-start' }
});
