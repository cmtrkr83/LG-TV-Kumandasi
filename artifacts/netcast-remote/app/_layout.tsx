import React, { useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LanguageProvider } from '@/i18n';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform } from 'react-native';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Full-screen remote: hide system bars (immersive sticky — edge swipe
// reveals the Android bar temporarily). Status bar stays hidden.
async function applyImmersiveMode() {
  if (Platform.OS === 'android') {
    try {
      await NavigationBar.setVisibilityAsync('hidden');
    } catch {
      // Older devices / Expo Go without the native module: stay non-immersive.
    }
  }
}

void applyImmersiveMode();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [languageReady, setLanguageReady] = useState(false);
  const handleLanguageReady = useCallback(() => {
    setLanguageReady(true);
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && languageReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, languageReady]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <LanguageProvider onReady={handleLanguageReady}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <StatusBar hidden />
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </LanguageProvider>
  );
}
