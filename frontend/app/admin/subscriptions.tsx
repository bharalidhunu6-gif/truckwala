import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput } from "react-native";
import { useFocusEffect, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, spacing, type, radius } from "@/src/theme";
import { EmptyState, Card, Tag, SkeletonCard } from "@/src/ui";
import { AdminShell } from "@/src/admin/AdminShell";

export default function AdminSubscriptions() {
  const { user, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<"active" | "pending" | "failed" | "all">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.adminSubscriptions(filter === "all" ? undefined : filter, debouncedQuery || undefined);
      setRows(r);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filter, debouncedQuery]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(h);
  }, [query]);

  if (authLoading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin") return <Redirect href="/(app)/home" />;

  return (
    <AdminShell title="Subscriptions" subtitle="Driver monthly plans">
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.onSurfaceDim} />
          <TextInput
            value={query} onChangeText={setQuery}
            placeholder="Search vehicle, driver or transaction ID"
            placeholderTextColor={colors.onSurfaceDim}
            style={{ flex: 1, ...type.body, color: colors.onSurface, paddingVertical: 4 }}
          />
          {query.length > 0 && <Pressable onPress={() => setQuery("")}><Ionicons name="close-circle" size={18} color={colors.onSurfaceMuted} /></Pressable>}
        </View>
        <View style={styles.filters}>
          {(["active", "pending", "failed", "all"] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterTab, filter === f && styles.filterTabActive]}>
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? <><SkeletonCard /><SkeletonCard /></> :
          rows.length === 0 ? (
            <EmptyState icon="receipt-outline" title="No subscriptions" subtitle="Nothing to show right now." />
          ) : (
            rows.map((s, idx) => (
              <Animated.View key={s.id} entering={FadeInDown.delay(idx * 40).duration(300)}>
                <Card style={styles.card}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={styles.regChip}><Text style={styles.regTxt}>{s.reg_number || "N/A"}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.h3}>₹{s.amount_inr}/month</Text>
                      <Text style={type.small}>{s.driver_name || "Driver"}</Text>
                    </View>
                    <Tag
                      label={s.status.toUpperCase()}
                      tone={s.status === "active" ? "success" : s.status === "failed" ? "error" : "warning"}
                    />
                  </View>
                  <View style={styles.txnRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={type.label}>ORDER ID</Text>
                      <Text style={{ ...type.small, color: colors.onSurface }} numberOfLines={1}>{s.razorpay_order_id || "—"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.label}>PAYMENT ID</Text>
                      <Text style={{ ...type.small, color: colors.onSurface }} numberOfLines={1}>{s.razorpay_payment_id || "—"}</Text>
                    </View>
                  </View>
                  <View style={styles.txnRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={type.label}>CREATED</Text>
                      <Text style={type.small}>{new Date(s.created_at).toLocaleString("en-IN")}</Text>
                    </View>
                    {s.expires_at && (
                      <View style={{ flex: 1 }}>
                        <Text style={type.label}>EXPIRES</Text>
                        <Text style={type.small}>{new Date(s.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Text>
                      </View>
                    )}
                  </View>
                </Card>
              </Animated.View>
            ))
          )
        }
      </ScrollView>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  filters: { flexDirection: "row", paddingBottom: spacing.md, gap: 6 },
  filterTab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  filterTabActive: { backgroundColor: colors.brand },
  filterText: { ...type.small, fontWeight: "700", color: colors.onSurfaceMuted, fontSize: 11 },
  filterTextActive: { color: colors.onBrand },
  card: { padding: spacing.lg, marginBottom: spacing.md, gap: spacing.md },
  regChip: { backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  regTxt: { ...type.small, color: colors.onBrand, fontWeight: "800" },
  txnRow: { flexDirection: "row", gap: spacing.md, paddingTop: 8, borderTopWidth: 1, borderColor: colors.divider },
});

