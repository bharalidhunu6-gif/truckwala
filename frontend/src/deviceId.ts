/**
 * Stable per-install device identifier used to reason about which device
 * currently holds a truck "online". Persisted in AsyncStorage so it survives
 * app restarts. Only rotates on reinstall / storage wipe.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";

const KEY = "tw_device_id";

function randomId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${Platform.OS}-${t}-${rand}`;
}

let cache: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cache) return cache;
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    // Prefer the OS-provided stable id (Android). Falls back to random on iOS/Web.
    let base: string | null = null;
    try {
      if (Platform.OS === "android") {
        base = Application.getAndroidId?.() ?? null;
      } else if (Platform.OS === "ios") {
        base = (await Application.getIosIdForVendorAsync?.()) ?? null;
      }
    } catch {}
    id = base ? `${Platform.OS}-${base}` : randomId();
    await AsyncStorage.setItem(KEY, id);
  }
  cache = id;
  return id;
}
