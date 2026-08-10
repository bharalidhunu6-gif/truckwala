import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Location from "expo-location";
import { useAuth } from "@/src/auth";
import { api, getToken } from "@/src/api";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button, EmptyState, Card, Tag, SkeletonCard } from "@/src/ui";
import { useNotificationSound } from "@/src/sound";
import { useNotifications } from "@/src/notifications";
import {
  startOnlineMode,
  stopOnlineMode,
  isOnlineModeActive,
  isBackgroundLocationSupported,
} from "@/src/backgroundLocation";

const HERO_IMG = "https://images.unsplash.com/photo-1755728531140-88e0b2a72d75";

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDriver = user?.role === "driver";

  const [items, setItems] = useState<any[]>([]);
  const [driverCtx, setDriverCtx] = useState<any>(null);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [earnings, setEarnings] = useState<any>(null);
  const [driverGps, setDriverGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsRequesting, setGpsRequesting] = useState(false);
  const [onlineMode, setOnlineMode] = useState(false);
  const playSound = useNotificationSound();
  const lastIdsRef = useRef<Set<string>>(new Set());
  const notif = useNotifications();

  const requestGps = useCallback(async () => {
    setGpsRequesting(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { Alert.alert("Permission needed", "Enable location to see nearby loads within 100 km."); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setDriverGps({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      // Also persist to the server so it can push new_load pings to us.
      try {
        const token = await getToken();
        await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/users/me/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
        });
      } catch {}
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setGpsRequesting(false); }
  }, []);

  const toggleOnline = useCallback(async () => {
    if (onlineMode) {
      await stopOnlineMode();
      setOnlineMode(false);
      Alert.alert("Went offline", "Auto-location paused.");
      return;
    }
    if (!isBackgroundLocationSupported()) {
      Alert.alert(
        "Native build required",
        "Automatic background location needs an iOS / Android build. You can still tap 'Enable' for a one-time update."
      );
      return;
    }
    const token = await getToken();
    const res = await startOnlineMode(token || "");
    if (res.ok) {
      setOnlineMode(true);
      Alert.alert("You're online", "Your location will refresh in the background so nearby loads reach you first.");
    } else if (res.reason === "background-denied") {
      Alert.alert("Background permission required", "Grant 'Allow all the time' in Settings.");
    }
  }, [onlineMode]);

  // Sync online toggle with actual task state on mount.
  useEffect(() => { isOnlineModeActive().then(setOnlineMode); }, []);

  // A push notification for our role should trigger a list refresh + chirp.
  useEffect(() => {
    if (!notif.last) return;
    if (isDriver && notif.last.type === "new_load") load();
    else if (!isDriver && (notif.last.type === "new_quote" || notif.last.type === "booking_status")) load();
    else if (isDriver && (notif.last.type === "booking_accepted" || notif.last.type === "booking_status")) load();
    // Sound is already played by NotificationsProvider.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notif.last]);

  const load = useCallback(async () => {
    try {
      if (isDriver) {
        const [openRes, e] = await Promise.all([
          api.openShipments(driverGps?.lat, driverGps?.lng, { show_all_types: showAllTypes }),
          api.earnings(),
        ]);
        const open = openRes?.items ?? openRes ?? [];  // graceful: old array or new {items,context}
        setDriverCtx(openRes?.context ?? null);
        // Detect newly-arrived shipments and play a chirp
        const currentIds = new Set<string>(open.map((s: any) => s.id));
        const newOnes = [...currentIds].filter((id) => !lastIdsRef.current.has(id));
        if (lastIdsRef.current.size > 0 && newOnes.length > 0) {
          playSound("new");
        }
        lastIdsRef.current = currentIds;
        setItems(open);
        setEarnings(e);
      } else {
        const mine = await api.myShipments();
        // Customer side: chime when a shipment status advances (new quote handled on shipment screen)
        const nowMap = new Map<string, string>(mine.map((s: any) => [s.id, s.status]));
        if (lastIdsRef.current.size > 0) {
          for (const s of mine) {
            const prevStatus = (lastIdsRef.current as any)._statuses?.get?.(s.id);
            if (prevStatus && prevStatus !== s.status) { playSound("new"); break; }
          }
        }
        (lastIdsRef.current as any)._statuses = nowMap;
        setItems(mine);
      }
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [isDriver, driverGps?.lat, driverGps?.lng, showAllTypes, playSound]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topbar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hi}>Good day 👋</Text>
            <Text testID="home-user-name" style={styles.name}>{user?.name}</Text>
          </View>
          <Pressable onPress={() => router.push("/(app)/profile")} testID="home-avatar" style={styles.avatar}>
            <Text style={{ ...type.h3, color: colors.onBrand }}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* HERO */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.hero}>
          <Image source={HERO_IMG} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(11,15,20,0.15)", "rgba(11,15,20,0.85)"]} style={StyleSheet.absoluteFill} />
          <View style={styles.heroContent}>
            <Tag label={isDriver ? "AVAILABLE LOADS" : "MOVE ANYTHING"} tone="brand" />
            <Text style={styles.heroTitle}>{isDriver ? "Find your\nnext haul." : "Post a load.\nGet quotes fast."}</Text>
            {!isDriver ? (
              <Button testID="home-post-shipment-cta" label="Post a shipment" onPress={() => router.push("/(app)/post")} leftIcon="add-circle-outline" style={{ marginTop: spacing.lg, alignSelf: "flex-start" }} />
            ) : (
              <Button testID="home-view-trucks-cta" label="Manage my trucks" variant="secondary" onPress={() => router.push("/(app)/post")} leftIcon="car-outline" style={{ marginTop: spacing.lg, alignSelf: "flex-start" }} />
            )}
          </View>
        </Animated.View>

        {/* Driver metric cards */}
        {isDriver && earnings && (
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.metricsRow}>
            <MetricCard icon="cash-outline" value={`₹${Math.round(earnings.total_earned_inr).toLocaleString("en-IN")}`} label="Earned" color={colors.success} />
            <MetricCard icon="checkmark-done-outline" value={String(earnings.trips_completed)} label="Trips" color={colors.brand} />
            <MetricCard icon="pulse-outline" value={String(earnings.active_trips)} label="Active" color={colors.warning} />
          </Animated.View>
        )}

        {/* Quick actions - customer only */}
        {!isDriver && (
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.actionsRow}>
            <ActionTile icon="cube-outline" label="New shipment" onPress={() => router.push("/(app)/post")} />
            <ActionTile icon="cube" label="My bookings" onPress={() => router.push("/(app)/bookings")} />
            <ActionTile icon="star-outline" label="History" onPress={() => router.push("/(app)/bookings")} />
          </Animated.View>
        )}

        {/* List section */}
        <View style={styles.sectionHeader}>
          <Text style={type.h3}>
            {isDriver
              ? `Loads within ${driverCtx?.effective_radius_km ?? 20} km${driverGps ? "" : " (base)"}`
              : "My shipments"}
          </Text>
          <Text style={type.small}>{items.length} total</Text>
        </View>

        {/* Driver: tier / truck-type filter chips */}
        {isDriver && driverCtx && (
          <View style={styles.filterRow}>
            <View style={styles.tierChip}>
              <Ionicons name="shield-checkmark" size={12} color={colors.brand} />
              <Text style={styles.tierChipText}>
                {driverCtx.effective_radius_km}km · {driverCtx.truck_types?.length || 0} model{(driverCtx.truck_types?.length || 0) === 1 ? "" : "s"}
              </Text>
            </View>
            <Pressable testID="toggle-all-types" onPress={() => setShowAllTypes((v) => !v)} style={[styles.toggleChip, showAllTypes && styles.toggleChipActive]}>
              <Ionicons name={showAllTypes ? "eye" : "eye-off-outline"} size={12} color={showAllTypes ? colors.onBrand : colors.onSurfaceMuted} />
              <Text style={[styles.toggleChipText, showAllTypes && { color: colors.onBrand }]}>
                {showAllTypes ? "Showing all types" : "My models only"}
              </Text>
            </Pressable>
          </View>
        )}

        {isDriver && (
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.body, fontWeight: "700" }}>{onlineMode ? "You're online" : "Go online"}</Text>
              <Text style={type.small}>{onlineMode ? "Auto-sharing GPS. Getting priority on nearby loads." : "Background GPS off. Turn on to auto-refresh nearby loads."}</Text>
            </View>
            <Button testID="online-toggle" label={onlineMode ? "Go offline" : "Go online"} variant={onlineMode ? "secondary" : "primary"} onPress={toggleOnline} size="md" />
          </View>
        )}

        {isDriver && !driverGps && !onlineMode && (
          <View style={styles.gpsBanner}>
            <Ionicons name="navigate-circle-outline" size={20} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.body, fontWeight: "700" }}>Share location once</Text>
              <Text style={type.small}>Or "Go online" above for automatic refresh.</Text>
            </View>
            <Button testID="enable-gps-btn" label={gpsRequesting ? "..." : "Enable"} onPress={requestGps} size="md" />
          </View>
        )}

        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : items.length === 0 ? (
          <EmptyState
            testID="home-empty"
            icon={isDriver ? "search-outline" : "cube-outline"}
            title={isDriver ? "No loads nearby" : "No shipments yet"}
            subtitle={isDriver ? "Pull to refresh. New loads appear as customers post them." : "Post your first shipment to get quotes from truck operators."}
            action={!isDriver ? <Button label="Post a shipment" onPress={() => router.push("/(app)/post")} leftIcon="add-outline" /> : null}
          />
        ) : (
          items.map((s, idx) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(idx * 40).duration(300)}>
              <Card
                testID={`shipment-card-${s.id}`}
                onPress={() => router.push(`/shipment/${s.id}`)}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={styles.routeDot} />
                    <Text style={styles.routeTxt} numberOfLines={1}>{s.pickup_city}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.onSurfaceDim} />
                    <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.routeTxt} numberOfLines={1}>{s.drop_city}</Text>
                  </View>
                  <Tag
                    label={s.status.replace("_", " ")}
                    tone={s.status === "open" ? "brand" : s.status === "delivered" ? "success" : s.status === "in_transit" ? "warning" : "default"}
                  />
                </View>
                <View style={styles.metricStrip}>
                  <Metric icon="scale-outline" val={`${s.weight_kg} kg`} lbl="Weight" />
                  <Metric icon="cube-outline" val={String(s.packages)} lbl="Packages" />
                  <Metric icon="navigate-outline" val={`${s.distance_km} km`} lbl="Distance" />
                </View>
                <View style={styles.cardFoot}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <Ionicons name="pricetag-outline" size={13} color={colors.onSurfaceDim} />
                    <Text style={type.small} numberOfLines={1}>
                      {s.goods_category} · {s.truck_type_preferred || "Any truck"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceDim} />
                </View>
              </Card>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function MetricCard({ icon, value, label, color }: any) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.metricVal}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}

function ActionTile({ icon, label, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionTile, pressed && { opacity: 0.7 }]}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={20} color={colors.brand} /></View>
      <Text style={styles.actionLbl}>{label}</Text>
    </Pressable>
  );
}

function Metric({ icon, val, lbl }: any) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Ionicons name={icon} size={14} color={colors.onSurfaceDim} />
      <View>
        <Text style={{ ...type.body, fontWeight: "700", fontSize: 13 }}>{val}</Text>
        <Text style={{ ...type.small, fontSize: 10 }}>{lbl}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  hi: { ...type.small },
  name: { ...type.h2, marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  hero: {
    height: 240, marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderRadius: radius.lg, overflow: "hidden",
    ...shadow.md,
  },
  heroContent: { flex: 1, padding: spacing.lg, justifyContent: "flex-end" },
  heroTitle: { ...type.display, color: colors.onSurfaceInverse, fontSize: 28, lineHeight: 32, marginTop: 8 },
  metricsRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  metricCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadow.sm,
  },
  metricIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  metricVal: { ...type.metric, fontSize: 18 },
  metricLbl: { ...type.small, marginTop: 2 },
  actionsRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  actionTile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border, ...shadow.sm,
  },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  actionLbl: { ...type.small, color: colors.onSurface, fontWeight: "600", textAlign: "center" },
  sectionHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  gpsBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: spacing.lg, padding: spacing.md,
    backgroundColor: colors.brandLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.brand,
    marginBottom: spacing.md,
  },
  onlineRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: spacing.lg, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  onlineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  filterRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: spacing.lg, marginBottom: spacing.md, alignItems: "center",
  },
  tierChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.brandLight, borderWidth: 1, borderColor: colors.brand,
  },
  tierChipText: { ...type.small, color: colors.brand, fontWeight: "700", fontSize: 11 },
  toggleChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  toggleChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  toggleChipText: { ...type.small, color: colors.onSurfaceMuted, fontWeight: "700", fontSize: 11 },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, gap: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  routeTxt: { ...type.body, fontWeight: "700", fontSize: 14, maxWidth: 90 },
  metricStrip: {
    flexDirection: "row", gap: 12, paddingVertical: 10,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider,
  },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
