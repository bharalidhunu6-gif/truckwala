/**
 * Background GPS for Truck Wala drivers.
 *
 * Two modes share a single expo-task-manager task:
 *   - "trip"   — POSTs coords to /api/bookings/{bookingId}/location
 *   - "online" — POSTs coords to /api/users/me/location (feeds the 100 km filter)
 * When both are active (driver browsing loads while a trip runs), we post to
 * BOTH endpoints per tick.  In Expo Go the module gracefully no-ops.
 */
import { Platform, AppRegistry } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TASK_NAME = "freightos-live-location";
const CTX_KEY = "fos_bg_ctx";
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Ctx = { token: string; bookingId?: string; online?: boolean };

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
    if (error) { console.log("[bg-loc]", error); return; }
    const { locations } = (data || {}) as any;
    if (!locations || !locations.length) return;
    const raw = await AsyncStorage.getItem(CTX_KEY);
    if (!raw) return;
    const ctx = JSON.parse(raw) as Ctx;
    const last = locations[locations.length - 1];
    // Reject spoofed coordinates on Android — Fake-GPS apps set coords.mocked=true.
    if (last?.coords?.mocked === true || last?.mocked === true) {
      console.log("[bg-loc] dropped mocked fix", last);
      return;
    }
    const lat = last.coords.latitude;
    const lng = last.coords.longitude;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${ctx.token}` };
    const body = JSON.stringify({ lat, lng });
    const targets: string[] = [];
    if (ctx.bookingId) targets.push(`${BASE}/api/bookings/${ctx.bookingId}/location`);
    if (ctx.online) targets.push(`${BASE}/api/users/me/location`);
    await Promise.all(targets.map((url) => fetch(url, { method: "POST", headers, body }).catch(() => null)));
  });
}

export function isBackgroundLocationSupported(): boolean {
  if (Platform.OS === "web") return false;
  return Constants.appOwnership !== "expo";
}

async function _persistCtx(partial: Partial<Ctx>) {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const existing: Ctx = raw ? JSON.parse(raw) : { token: "" };
  const next: Ctx = { ...existing, ...partial };
  await AsyncStorage.setItem(CTX_KEY, JSON.stringify(next));
  return next;
}

async function _ensureTaskRunning() {
  const running = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
  if (running) return;
  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15000,
    distanceInterval: 100,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Truck Wala is sharing your location",
      notificationBody: "You'll see nearby loads within 100 km and customers can track live trips.",
      notificationColor: "#0A5AF0",
    },
    pausesUpdatesAutomatically: false,
  });
}

async function _stopIfIdle() {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const ctx: Ctx = raw ? JSON.parse(raw) : { token: "" };
  if (!ctx.bookingId && !ctx.online) {
    const running = await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
    if (running) await Location.stopLocationUpdatesAsync(TASK_NAME);
  }
}

// ---------- Trip mode ----------
export async function startBackgroundTrip(bookingId: string, token: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isBackgroundLocationSupported()) return { ok: false, reason: "not-supported-in-expo-go" };
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok: false, reason: "foreground-denied" };
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return { ok: false, reason: "background-denied" };
  await _persistCtx({ token, bookingId });
  await _ensureTaskRunning();
  return { ok: true };
}

export async function stopBackgroundTrip(): Promise<void> {
  await _persistCtx({ bookingId: undefined });
  await _stopIfIdle();
}

export async function isBackgroundTripActive(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const ctx: Ctx = raw ? JSON.parse(raw) : { token: "" };
  return !!ctx.bookingId && await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
}

// ---------- Online mode (driver browsing loads) ----------
export async function startOnlineMode(token: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isBackgroundLocationSupported()) return { ok: false, reason: "not-supported-in-expo-go" };
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok: false, reason: "foreground-denied" };
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== "granted") return { ok: false, reason: "background-denied" };
  await _persistCtx({ token, online: true });
  await _ensureTaskRunning();
  return { ok: true };
}

export async function stopOnlineMode(): Promise<void> {
  await _persistCtx({ online: false });
  await _stopIfIdle();
}

export async function isOnlineModeActive(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const ctx: Ctx = raw ? JSON.parse(raw) : { token: "" };
  return !!ctx.online && await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(() => false);
}

void AppRegistry;
