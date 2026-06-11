import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import type { RegionId } from "@snyk-code-pulse/api-client";

import type { DestinationConfig } from "./destinations";

export interface Settings extends DestinationConfig {
  token: string;
  groupId: string;
  region: RegionId;
}

// This is the name of the device-local storage slot, not a credential. The
// actual secrets (API token) are user-supplied at runtime and never hardcoded.
// file deepcode ignore HardcodedNonCryptoSecret: storage slot name, not a secret
const SETTINGS_STORAGE_NAME = "snyk-code-pulse-settings";

export async function loadSettings(): Promise<Settings | null> {
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: SETTINGS_STORAGE_NAME });
    return value ? JSON.parse(value) : null;
  }
  const raw = localStorage.getItem(SETTINGS_STORAGE_NAME);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSettings(s: Settings): Promise<void> {
  const json = JSON.stringify(s);
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: SETTINGS_STORAGE_NAME, value: json });
  } else {
    localStorage.setItem(SETTINGS_STORAGE_NAME, json);
  }
}

export async function clearSettings(): Promise<void> {
  if (Capacitor.isNativePlatform()) await Preferences.remove({ key: SETTINGS_STORAGE_NAME });
  else localStorage.removeItem(SETTINGS_STORAGE_NAME);
}
