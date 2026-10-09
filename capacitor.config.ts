import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.crunchytrail.asmr',
  appName: 'Crunchy Trail',
  webDir: 'dist-native',
  backgroundColor: '#ffe9f1',
  ios: {
    contentInset: 'never',
    backgroundColor: '#ffe9f1',
  },
  android: {
    backgroundColor: '#ffe9f1',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#fff1f7',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
