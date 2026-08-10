import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, spacing, type, radius } from "@/src/theme";
import { EmptyState, Tag, Card, SkeletonCard } from "@/src/ui";

export default function Bookings() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const load = useCallback(async () => {
    try { const b = await api.myBookings(); setItems(b); }
    catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isDriver = user?.role === "driver";
  const filtered = items.filter((b) =>
    filter === "all" ? true :
    filter === "active" ? b.status !== "delivered" :
    b.status === "delivered"
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topbar}>
          <View>
            <Text style={type.small}>{isDriver ? "Trip Log" : "Booking History"}</Text>
            <Text style={type.h2}>{isDriver ? "My Trips" : "My Bookings"}</Text>
          </View>
        </View>
        <View style={styles.filters}>
          {(["all", "active", "completed"] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} testID={`filter-${f}`} style={[styles.filterTab, filter === f && styles.filterTabActive]}>
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 80, paddingTop: spacing.md }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : filtered.length === 0 ? (
          <EmptyState
            testID="bookings-empty"
            icon="cube-outline"
            title="No bookings yet"
            subtitle={isDriver ? "Your accepted trips will appear here." : "Confirmed bookings will appear here."}
          />
        ) : (
          filtered.map((b, idx) => (
            <Animated.View key={b.id} entering={FadeInDown.delay(idx * 40).duration(300)}>
              <Card
                testID={`booking-card-${b.id}`}
                onPress={() => router.push(`/booking/${b.id}`)}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={styles.routeDot} />
                    <Text style={styles.routeTxt} numberOfLines={1}>{b.pickup_city}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.onSurfaceDim} />
                    <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
                    <Text style={styles.routeTxt} numberOfLines={1}>{b.drop_city}</Text>
                  </View>
                  <Tag
                    label={b.status.replace("_", " ")}
                    tone={b.status === "delivered" ? "success" : b.status === "in_transit" ? "warning" : "brand"}
                  />
                </View>
                <View style={styles.priceRow}>
                  <View>
                    <Text style={type.small}>Price</Text>
                    <Text style={type.metric}>₹{Math.round(b.price_inr).toLocaleString("en-IN")}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={type.small}>{b.distance_km} km · {b.weight_kg} kg</Text>
                    <Text style={[type.small, { color: colors.onSurface, fontWeight: "600", marginTop: 2 }]}>
                      {isDriver ? b.customer_name : b.driver_name}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardFoot}>
                  <Tag
                    label={b.payment_status === "paid" ? "PAID" : "UNPAID"}
                    tone={b.payment_status === "paid" ? "success" : "warning"}
                    icon={b.payment_status === "paid" ? "checkmark-circle" : "time-outline"}
                  />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={type.small}>View details</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceDim} />
                  </View>
                </View>
              </Card>
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topbar: { padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  filters: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 8, backgroundColor: colors.surface },
  filterTab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  filterTabActive: { backgroundColor: colors.brand },
  filterText: { ...type.small, fontWeight: "700", color: colors.onSurfaceMuted },
  filterTextActive: { color: colors.onBrand },
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, gap: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  routeTxt: { ...type.body, fontWeight: "700", fontSize: 14, maxWidth: 90 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
