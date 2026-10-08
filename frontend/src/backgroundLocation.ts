/**
 * Background GPS for Truck Wala drivers.
 *
 * Background location is used only during an active trip.
 * The driver explicitly starts it from the "Share live location" button.
 */
import { Platform, AppRegistry } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TASK_NAME = "freightos-live-location";
const CTX_KEY = "fos_bg_ctx";
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Ctx = {
  token: string;
  bookingId?: string;
};

if (!TaskManager.isTaskDefined(TASK_NAME)) {
  TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.log("[bg-loc]", error);
      return;
    }

    const { locations } = (data || {}) as any;
    if (!locations || !locations.length) return;

    const raw = await AsyncStorage.getItem(CTX_KEY);
    if (!raw) return;

    const ctx = JSON.parse(raw) as Ctx;
    if (!ctx.bookingId) return;

    const last = locations[locations.length - 1];

    // Reject spoofed coordinates.
    if (last?.coords?.mocked === true || last?.mocked === true) {
      console.log("[bg-loc] dropped mocked fix", last);
      return;
    }

    const lat = last.coords.latitude;
    const lng = last.coords.longitude;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.token}`,
    };

    const body = JSON.stringify({ lat, lng });

    await fetch(
      `${BASE}/api/bookings/${ctx.bookingId}/location`,
      {
        method: "POST",
        headers,
        body,
      }
    ).catch(() => null);
  });
}

export function isBackgroundLocationSupported(): boolean {
  if (Platform.OS === "web") return false;
  return Constants.appOwnership !== "expo";
}

async function _persistCtx(partial: Partial<Ctx>) {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const existing: Ctx = raw ? JSON.parse(raw) : { token: "" };

  const next: Ctx = {
    ...existing,
    ...partial,
  };

  await AsyncStorage.setItem(CTX_KEY, JSON.stringify(next));
  return next;
}

async function _ensureTaskRunning() {
  const running = await Location.hasStartedLocationUpdatesAsync(
    TASK_NAME
  ).catch(() => false);

  if (running) return;

  await Location.startLocationUpdatesAsync(TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15000,
    distanceInterval: 100,

    showsBackgroundLocationIndicator: true,

    foregroundService: {
      notificationTitle: "Truck Wala is sharing your location",
      notificationBody:
        "Your live location is being shared with the customer during this trip.",
      notificationColor: "#0A5AF0",
    },

    pausesUpdatesAutomatically: false,
  });
}

export async function startBackgroundTrip(
  bookingId: string,
  token: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!isBackgroundLocationSupported()) {
    return {
      ok: false,
      reason: "not-supported-in-expo-go",
    };
  }

  const fg = await Location.requestForegroundPermissionsAsync();

  if (fg.status !== "granted") {
    return {
      ok: false,
      reason: "foreground-denied",
    };
  }

  const bg = await Location.requestBackgroundPermissionsAsync();

  if (bg.status !== "granted") {
    return {
      ok: false,
      reason: "background-denied",
    };
  }

  await _persistCtx({
    token,
    bookingId,
  });

  await _ensureTaskRunning();

  return {
    ok: true,
  };
}

export async function stopBackgroundTrip(): Promise<void> {
  await _persistCtx({
    bookingId: undefined,
  });

  const running = await Location.hasStartedLocationUpdatesAsync(
    TASK_NAME
  ).catch(() => false);

  if (running) {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  }
}

export async function isBackgroundTripActive(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(CTX_KEY);
  const ctx = raw ? (JSON.parse(raw) as Ctx) : { token: "" };

  return (
    !!ctx.bookingId &&
    await Location.hasStartedLocationUpdatesAsync(TASK_NAME).catch(
      () => false
    )
  );
}

void AppRegistry;