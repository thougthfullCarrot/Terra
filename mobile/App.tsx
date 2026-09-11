import { useFonts } from 'expo-font';
// Imported one face at a time. Importing from the package root pulls every
// weight and italic of both families into the bundle — about 2.8MB of fonts
// the design never asks for.
import Archivo_400Regular from '@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf';
import Archivo_500Medium from '@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf';
import Archivo_600SemiBold from '@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf';
import Archivo_700Bold from '@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf';
import JetBrainsMono_500Medium from '@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf';
import JetBrainsMono_700Bold from '@expo-google-fonts/jetbrains-mono/700Bold/JetBrainsMono_700Bold.ttf';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { color } from './src/theme/tokens';
import { useApp } from './src/state';
import { TabBar } from './src/components/TabBar';
import { FeedScreen } from './src/screens/FeedScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { PipelineScreen } from './src/screens/PipelineScreen';
import { SavedScreen } from './src/screens/SavedScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { DetailSheet } from './src/screens/DetailSheet';

/**
 * Five screens behind a custom tab bar, plus a detail sheet that pushes over
 * whichever screen is showing. There is no navigator: the handoff specifies
 * `tab` and `detail` as plain client state, and a router would only be
 * something to override.
 */
export default function App() {
  const app = useApp();

  const [fontsLoaded] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold
  });

  // Archivo and JetBrains Mono carry the whole design. Rendering in the system
  // face first and swapping would reflow every screen, so hold the empty page
  // on the app background until they are ready.
  if (!fontsLoaded) return <View style={styles.app} />;

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />

      {app.tab === 'feed' ? <FeedScreen {...app} /> : null}
      {app.tab === 'market' ? <MarketScreen {...app} /> : null}
      {app.tab === 'pipeline' ? <PipelineScreen {...app} /> : null}
      {app.tab === 'saved' ? <SavedScreen {...app} /> : null}
      {app.tab === 'profile' ? <ProfileScreen {...app} /> : null}

      {/* The tab bar hides while the sheet is open. */}
      {app.detail ? (
        <DetailSheet app={app} id={app.detail} />
      ) : (
        <TabBar tab={app.tab} onPick={app.openTab} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: color.bg }
});
