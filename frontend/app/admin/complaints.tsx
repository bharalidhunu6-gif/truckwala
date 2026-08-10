import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, TextInput, Alert } from "react-native";
import { useFocusEffect, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, spacing, type, radius } from "@/src/theme";
import { Button, EmptyState, Card, Tag, inputStyle, SkeletonCard } from "@/src/ui";
import { AdminShell } from "@/src/admin/AdminShell";

export default function AdminComplaints() {
  const { user, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ complaint: any; action: "resolve" | "dismiss" } | null>(null);
  const [modalReason, setModalReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.adminComplaints(filter === "all" ? undefined : filter, debouncedQuery || undefined);
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

  const submitModal = async () => {
    if (!modal) return;
    setBusy(modal.complaint.id);
    try {
      await api.adminResolveComplaint(modal.complaint.id, modalReason, modal.action);
      setModal(null); setModalReason(""); load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };

  return (
    <AdminShell title="Complaints" subtitle="Shipper reports">
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.onSurfaceDim} />
          <TextInput
            value={query} onChangeText={setQuery}
            placeholder="Search vehicle, driver or subject"
            placeholderTextColor={colors.onSurfaceDim}
            autoCapitalize="characters"
            style={{ flex: 1, ...type.body, color: colors.onSurface, paddingVertical: 4 }}
          />
          {query.length > 0 && <Pressable onPress={() => setQuery("")}><Ionicons name="close-circle" size={18} color={colors.onSurfaceMuted} /></Pressable>}
        </View>
        <View style={styles.filters}>
          {(["open", "resolved", "dismissed", "all"] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterTab, filter === f && styles.filterTabActive]}>
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? <><SkeletonCard /><SkeletonCard /></> :
          rows.length === 0 ? (
            <EmptyState icon="thumbs-up-outline" title="No complaints" subtitle="Nothing to review right now." />
          ) : (
            rows.map((c, idx) => (
              <Animated.View key={c.id} entering={FadeInDown.delay(idx * 40).duration(300)}>
                <Card style={styles.card}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={styles.regChip}><Text style={styles.regTxt}>{c.reg_number || "N/A"}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={type.h3}>{c.subject}</Text>
                      <Text style={type.small}>{c.driver_name || "Driver"} · Filed by {c.customer_name || "Shipper"}</Text>
                    </View>
                    <Tag
                      label={c.status.toUpperCase()}
                      tone={c.status === "open" ? "warning" : c.status === "resolved" ? "success" : "default"}
                    />
                  </View>
                  <Text style={{ ...type.body, marginTop: 4 }}>{c.message}</Text>
                  <Text style={type.small}>
                    {new Date(c.created_at).toLocaleString("en-IN")}
                  </Text>
                  {c.resolution ? (
                    <View style={styles.resBox}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                      <Text style={{ ...type.small, color: colors.onSurface, flex: 1 }}>{c.resolution}</Text>
                    </View>
                  ) : null}
                  {c.status === "open" && (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Button label="Dismiss" variant="ghost" leftIcon="close-outline" loading={busy === c.id} onPress={() => { setModal({ complaint: c, action: "dismiss" }); setModalReason(""); }} />
                      <Button label="Resolve" leftIcon="checkmark-outline" loading={busy === c.id} onPress={() => { setModal({ complaint: c, action: "resolve" }); setModalReason(""); }} />
                    </View>
                  )}
                </Card>
              </Animated.View>
            ))
          )
        }
      </ScrollView>

      <Modal visible={!!modal} animationType="fade" transparent onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={[type.h2, { marginBottom: 8 }]}>
              {modal?.action === "resolve" ? "Resolve complaint" : "Dismiss complaint"}
            </Text>
            <TextInput
              value={modalReason}
              onChangeText={setModalReason}
              placeholder="Resolution note (optional)"
              placeholderTextColor={colors.onSurfaceDim}
              style={[inputStyle, { minHeight: 80 }]}
              multiline
            />
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={() => setModal(null)} fullWidth /></View>
              <View style={{ flex: 1 }}><Button label="Confirm" onPress={submitModal} loading={!!busy} fullWidth /></View>
            </View>
          </View>
        </View>
      </Modal>
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
  card: { padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  regChip: { backgroundColor: colors.brand, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  regTxt: { ...type.small, color: colors.onBrand, fontWeight: "800" },
  resBox: { flexDirection: "row", gap: 6, alignItems: "flex-start", padding: 10, backgroundColor: colors.successLight, borderRadius: radius.md },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", padding: spacing.lg, justifyContent: "center", alignItems: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, width: "100%", maxWidth: 480 },
});

