/**
 * Fake-GPS / mock-location detection.
 *
 * Android exposes `coords.mocked` on every location fix — if any location app
 * (Fake GPS, GPS JoyStick, Lockito, etc.) is feeding coordinates to the OS,
 * this flag comes back `true`. We use it to hard-block Truck Wala's driver
 * actions (going online, sharing live location, submitting quotes) because a
 * spoofed location = spoofed rides.
 *
 * iOS doesn't expose a public API for mock detection, so on iOS we
 * conservatively return `false` (allow through). A future hardening pass can
 * add a native module for iOS if abuse is observed.
 */
import * as Location from "expo-location";
import { Platform, Alert, Linking } from "react-native";

export type GpsCheck = {
  ok: boolean;
  reason?: string;
  location?: Location.LocationObject;
};

/** Fetch a single fix and inspect the mock flag. Never throws. */
export async function checkFakeGps(): Promise<GpsCheck> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.status !== "granted") {
        return { ok: false, reason: "Location permission is required to continue." };
      }
    }
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    // Android — Fake-GPS apps set this to true. iOS returns undefined.
    const mocked = (loc.coords as any)?.mocked === true || (loc as any)?.mocked === true;
    if (mocked && Platform.OS === "android") {
      return {
        ok: false,
        location: loc,
        reason: "A fake-GPS app has been detected on your phone. Disable it in Developer options and try again.",
      };
    }
    return { ok: true, location: loc };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Could not read location" };
  }
}

/** Convenience: pop a native alert on failure and offer a Settings shortcut. */
export function alertOnFakeGps(check: GpsCheck) {
  if (check.ok) return;
  Alert.alert(
    "Fake GPS detected",
    check.reason || "Please disable mock/fake-GPS apps to continue.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ],
  );
}
