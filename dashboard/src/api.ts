import { Capacitor } from "@capacitor/core";
import { SnykClient, REGIONS, type RegionId } from "@snyk-code-pulse/api-client";
import type { Settings } from "./settings";

/**
 * Browser dev/preview: route via the Vite proxy (/snyk-api/<region>) because
 * api.snyk.io sends no CORS headers. Native APK: Capacitor's CapacitorHttp
 * plugin patches fetch to use native HTTP, so we hit the region URL directly.
 */
export function makeClient(s: Settings): SnykClient {
  const native = Capacitor.isNativePlatform();
  return new SnykClient({
    token: s.token,
    baseUrl: native ? REGIONS[s.region as RegionId] : `/snyk-api/${s.region}`,
  });
}
