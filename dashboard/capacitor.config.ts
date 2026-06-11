import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.snyk.codepulse",
  appName: "Snyk Code Pulse",
  webDir: "dist",
  plugins: {
    // Native HTTP: requests from the APK go straight to api.snyk.io with no CORS.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
