import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, useWindowDimensions } from "react-native";
import { useRouter, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { AdminShell } from "@/src/admin/AdminShell";
import { colors, spacing, type, radius, shadow } from "@/src/theme";

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 4 : width >= 640 ? 3 : 2;

  const load = useCallback(async () => {
    try { setStats(await api.adminStats()); } catch (e) { console.log(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (authLoading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin") return <Redirect href="/(app)/home" />;

  const tiles = [
    { label: "Pending vehicles", value: stats?.trucks_pending ?? "—", icon: "time-outline", color: colors.warning, to: "/admin/trucks" },
    { label: "Approved fleet", value: stats?.trucks_approved ?? "—", icon: "checkmark-circle-outline", color: colors.success, to: "/admin/trucks" },
    { label: "Rejected", value: stats?.trucks_rejected ?? "—", icon: "close-circle-outline", color: colors.error, to: "/admin/trucks" },
    { label: "Banned", value: stats?.trucks_banned ?? 0, icon: "ban", color: colors.error, to: "/admin/trucks" },
    { label: "Open complaints", value: stats?.open_complaints ?? 0, icon: "alert-circle-outline", color: colors.warning, to: "/admin/complaints" },
    { label: "Active subscriptions", value: stats?.active_subscriptions ?? 0, icon: "shield-checkmark-outline", color: colors.success, to: "/admin/subscriptions" },
    { label: "Total users", value: stats?.total_users ?? "—", icon: "people-outline", color: colors.brand, to: "/admin/trucks" },
    { label: "Total bookings", value: stats?.total_bookings ?? "—", icon: "cube-outline", color: colors.brand, to: "/admin/trucks" },
  ];

  return (
    <AdminShell title="Dashboard" subtitle="Truck Wala · Operations">
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(300)}>
          <View style={styles.hero}>
            <View style={styles.heroBadge}><Ionicons name="rocket-outline" size={22} color={colors.onBrand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.h3, color: colors.onSurfaceInverse }}>Welcome back, {user?.name || "Admin"}</Text>
              <Text style={{ ...type.body, color: colors.onSurfaceInverse, opacity: 0.85 }}>
                Here&apos;s a quick snapshot of the marketplace right now.
              </Text>
            </View>
          </View>
        </Animated.View>

        <View style={[styles.grid, { gap: 12 }]}>
          {tiles.map((tile, idx) => (
            <Animated.View key={tile.label} entering={FadeInDown.delay(idx * 40).duration(300)} style={{ width: `${100 / cols}%`, padding: 6 }}>
              <Pressable testID={`tile-${tile.label}`} onPress={() => router.push(tile.to as any)} style={styles.tile}>
                <View style={[styles.tileIcon, { backgroundColor: tile.color + "18" }]}>
                  <Ionicons name={tile.icon as any} size={20} color={tile.color} />
                </View>
                <Text style={{ ...type.display, fontSize: 30, marginTop: 8 }}>{tile.value}</Text>
                <Text style={type.small}>{tile.label}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>

        <View style={styles.quickCard}>
          <Text style={type.h3}>Quick actions</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
            <QuickBtn label="Review pending vehicles" icon="checkbox-outline" onPress={() => router.push("/admin/trucks")} />
            <QuickBtn label="View open complaints" icon="alert-circle-outline" onPress={() => router.push("/admin/complaints")} />
            <QuickBtn label="Subscription payments" icon="card-outline" onPress={() => router.push("/admin/subscriptions")} />
          </View>
        </View>
      </ScrollView>
    </AdminShell>
  );
}

function QuickBtn({ label, icon, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.quickBtn}>
      <Ionicons name={icon} size={16} color={colors.brand} />
      <Text style={{ ...type.small, fontWeight: "700", color: colors.brand }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row", gap: 14, alignItems: "center",
    padding: spacing.xl, borderRadius: radius.lg,
    backgroundColor: colors.surfaceInverse,
    ...shadow.md,
  },
  heroBadge: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  tile: {
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    ...shadow.sm,
  },
  tileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quickCard: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow.sm },
  quickBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill,
    backgroundColor: colors.brandLight, borderWidth: 1, borderColor: colors.brand,
  },
});
