import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// api.snyk.io sends no CORS headers, so browser dev mode goes through this proxy.
// The Android APK uses Capacitor's native HTTP (no CORS) and hits the API directly.
const regionTargets: Record<string, string> = {
  "us-01": "https://api.snyk.io",
  "us-02": "https://api.us.snyk.io",
  "eu": "https://api.eu.snyk.io",
  "au": "https://api.au.snyk.io",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: Object.fromEntries(
      Object.entries(regionTargets).map(([region, target]) => [
        `/snyk-api/${region}`,
        {
          target,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(`/snyk-api/${region}`, ""),
        },
      ]),
    ),
  },
});
