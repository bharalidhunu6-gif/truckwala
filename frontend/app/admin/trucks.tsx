import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, TextInput, Alert, Image, useWindowDimensions } from "react-native";
import { useFocusEffect, useRouter, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button, EmptyState, Card, Tag, inputStyle, SkeletonCard } from "@/src/ui";
import { AdminShell } from "@/src/admin/AdminShell";

export default function AdminTrucks() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const twoCol = width >= 900;
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "banned" | "all">("pending");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [trucks, setTrucks] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ truck: any; action: "reject" | "ban" } | null>(null);
  const [modalReason, setModalReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ts, st] = await Promise.all([
        api.adminTrucks(filter === "all" || filter === "banned" ? undefined : filter, debouncedQuery || undefined),
        api.adminStats(),
      ]);
      const filtered = filter === "banned" ? ts.filter((t: any) => t.banned) : ts;
      setTrucks(filtered);
      setStats(st);
    } catch (e) { console.log(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [filter, debouncedQuery]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Debounce search input.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(h);
  }, [query]);

  if (authLoading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin") return <Redirect href="/(app)/home" />;

  const approve = async (id: string) => {
    setBusy(id);
    try { await api.adminApproveTruck(id); load(); }
    catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };
  const unban = async (id: string) => {
    setBusy(id);
    try { await api.adminUnbanTruck(id); load(); }
    catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };
  const del = async (t: any) => {
    Alert.alert("Delete truck?", `${t.reg_number} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(t.id);
        try { await api.adminDeleteTruck(t.id); load(); }
        catch (e: any) { Alert.alert("Error", e.message); }
        finally { setBusy(null); }
      }},
    ]);
  };
  const submitModal = async () => {
    if (!modal) return;
    setBusy(modal.truck.id);
    try {
      if (modal.action === "reject") await api.adminRejectTruck(modal.truck.id, modalReason);
      else await api.adminBanTruck(modal.truck.id, modalReason);
      setModal(null); setModalReason(""); load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };

  return (
    <AdminShell title="Vehicles" subtitle="Fleet management">
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.onSurfaceDim} />
          <TextInput
            testID="admin-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search by vehicle number or owner name"
            placeholderTextColor={colors.onSurfaceDim}
            autoCapitalize="characters"
            style={{ flex: 1, ...type.body, color: colors.onSurface, paddingVertical: 4 }}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceMuted} />
            </Pressable>
          )}
        </View>

        {/* Stats row */}
        {stats && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
            <StatCard icon="time-outline" color={colors.warning} value={stats.trucks_pending} label="Pending" />
            <StatCard icon="checkmark-circle-outline" color={colors.success} value={stats.trucks_approved} label="Approved" />
            <StatCard icon="close-circle-outline" color={colors.error} value={stats.trucks_rejected} label="Rejected" />
            <StatCard icon="ban" color={colors.error} value={stats.trucks_banned || 0} label="Banned" />
            <StatCard icon="alert-circle-outline" color={colors.warning} value={stats.open_complaints || 0} label="Complaints" />
            <StatCard icon="shield-checkmark-outline" color={colors.success} value={stats.active_subscriptions || 0} label="Active subs" />
          </ScrollView>
        )}

        <View style={styles.filters}>
          {(["pending", "approved", "rejected", "banned", "all"] as const).map((f) => (
            <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.filterTab, filter === f && styles.filterTabActive]}>
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : trucks.length === 0 ? (
          <EmptyState
            testID="admin-trucks-empty"
            icon="checkmark-done-outline"
            title={debouncedQuery ? "No matches" : "All clear!"}
            subtitle={debouncedQuery ? `No trucks match "${debouncedQuery}"` : `No ${filter === "all" ? "" : filter + " "}trucks at this time.`}
          />
        ) : (
          <View style={[styles.grid, twoCol && { flexDirection: "row", flexWrap: "wrap" }]}>
            {trucks.map((t, idx) => (
              <Animated.View
                key={t.id}
                entering={FadeInDown.delay(idx * 40).duration(300)}
                style={twoCol ? { width: "50%", padding: 6 } : undefined}
              >
                <Card style={styles.truckCard} testID={`admin-truck-${t.id}`}>
                  {/* Header row */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Pressable onPress={() => t.vehicle_photo && setPreview(t.vehicle_photo)} style={styles.thumbBox}>
                      {t.vehicle_photo ? (
                        <Image source={{ uri: t.vehicle_photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : (
                        <Ionicons name="car-sport" size={22} color={colors.brand} />
                      )}
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={type.h3}>{t.reg_number}</Text>
                        {t.verified_badge && (
                          <View style={styles.verifiedPill}>
                            <Ionicons name="ribbon" size={11} color={colors.success} />
                            <Text style={{ ...type.small, color: colors.success, fontWeight: "700", fontSize: 10 }}>VERIFIED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={type.small}>{t.truck_type} · {t.body_type} · {t.load_capacity_kg} kg</Text>
                      <Text style={{ ...type.small, color: colors.onSurfaceMuted, marginTop: 2 }}>
                        {t.owner_name} · {t.owner_phone || "—"}
                      </Text>
                    </View>
                  </View>

                  {/* Tags */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    <Tag
                      label={t.banned ? "banned" : (t.verification_status || "pending")}
                      tone={t.banned ? "error" : (t.verification_status === "approved" ? "success" : t.verification_status === "rejected" ? "error" : "warning")}
                      icon={t.banned ? "ban" : t.verification_status === "approved" ? "checkmark-circle" : t.verification_status === "rejected" ? "close-circle" : "time-outline"}
                    />
                    <Tag
                      label={t.subscription_active ? "SUB ACTIVE" : "SUB EXPIRED"}
                      tone={t.subscription_active ? "success" : "warning"}
                      icon="shield-checkmark"
                    />
                    {t.online && <Tag label="ONLINE" tone="success" icon="radio" />}
                    {t.complaints_open > 0 && <Tag label={`${t.complaints_open} COMPLAINT${t.complaints_open === 1 ? "" : "S"}`} tone="error" icon="alert-circle" />}
                    {t.completed_trips >= 50 && <Tag label={`${t.completed_trips} TRIPS`} tone="brand" icon="ribbon" />}
                  </View>

                  {/* Photos row */}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => t.vehicle_photo && setPreview(t.vehicle_photo)} style={styles.photo}>
                      {t.vehicle_photo ? (
                        <Image source={{ uri: t.vehicle_photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : <Text style={styles.photoLbl}>Vehicle</Text>}
                      <View style={styles.photoTag}><Text style={styles.photoTagTxt}>VEHICLE</Text></View>
                    </Pressable>
                    <Pressable onPress={() => t.rc_photo && setPreview(t.rc_photo)} style={styles.photo}>
                      {t.rc_photo ? (
                        <Image source={{ uri: t.rc_photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : <Text style={styles.photoLbl}>RC</Text>}
                      <View style={styles.photoTag}><Text style={styles.photoTagTxt}>RC</Text></View>
                    </Pressable>
                  </View>

                  {/* Subscription details */}
                  {t.subscription && (
                    <View style={styles.subBox}>
                      <View style={{ flex: 1 }}>
                        <Text style={type.label}>SUBSCRIPTION</Text>
                        <Text style={{ ...type.body, fontWeight: "700" }}>
                          ₹{t.subscription.amount_inr}/mo · {t.subscription.status.toUpperCase()}
                        </Text>
                        {t.subscription.razorpay_payment_id && (
                          <Text style={{ ...type.small, color: colors.onSurfaceMuted }} numberOfLines={1}>
                            TXN: {t.subscription.razorpay_payment_id}
                          </Text>
                        )}
                        {t.subscription_expires_at && (
                          <Text style={type.small}>
                            {t.subscription_active ? "Renews " : "Expired "}
                            {new Date(t.subscription_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </Text>
                        )}
                      </View>
                    </View>
                  )}

                  <View style={styles.metaGrid}>
                    <MetaCell label="BASE" value={t.base_city || "—"} />
                    <MetaCell label="DIM." value={t.dimensions || "—"} />
                  </View>

                  {(t.rejection_reason || t.ban_reason) ? (
                    <View style={styles.rejectBox}>
                      <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                      <Text style={{ ...type.small, color: colors.error, flex: 1 }}>{t.ban_reason || t.rejection_reason}</Text>
                    </View>
                  ) : null}

                  {/* Action buttons */}
                  <View style={styles.actionsRow}>
                    {t.verification_status === "pending" && (
                      <>
                        <Button testID={`reject-${t.id}`} label="Reject" variant="secondary" leftIcon="close-outline" loading={busy === t.id} onPress={() => { setModal({ truck: t, action: "reject" }); setModalReason(""); }} />
                        <Button testID={`approve-${t.id}`} label="Approve" leftIcon="checkmark-outline" loading={busy === t.id} onPress={() => approve(t.id)} />
                      </>
                    )}
                    {t.banned ? (
                      <Button testID={`unban-${t.id}`} label="Unban" variant="secondary" leftIcon="refresh-outline" loading={busy === t.id} onPress={() => unban(t.id)} />
                    ) : (
                      t.verification_status === "approved" && (
                        <Button testID={`ban-${t.id}`} label="Ban" variant="danger" leftIcon="ban" loading={busy === t.id} onPress={() => { setModal({ truck: t, action: "ban" }); setModalReason(""); }} />
                      )
                    )}
                    <Button testID={`delete-${t.id}`} label="Delete" variant="ghost" leftIcon="trash-outline" loading={busy === t.id} onPress={() => del(t)} />
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Reject / Ban Modal */}
      <Modal visible={!!modal} animationType="fade" transparent onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={[type.h2, { marginBottom: 8 }]}>
              {modal?.action === "ban" ? "Ban vehicle" : "Reject truck"}
            </Text>
            <Text style={[type.bodyMuted, { marginBottom: spacing.md }]}>
              {modal?.action === "ban"
                ? "The operator will be blocked from accepting new loads until admin unbans this vehicle."
                : "Provide a reason for rejection. The operator will see this."}
            </Text>
            <TextInput
              testID="modal-reason"
              value={modalReason}
              onChangeText={setModalReason}
              placeholder={modal?.action === "ban" ? "e.g. Repeated complaints" : "e.g. RC document unclear"}
              placeholderTextColor={colors.onSurfaceDim}
              style={[inputStyle, { minHeight: 80 }]}
              multiline
            />
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={() => { setModal(null); setModalReason(""); }} fullWidth /></View>
              <View style={{ flex: 1 }}><Button testID="modal-confirm" label={modal?.action === "ban" ? "Ban" : "Reject"} variant="danger" onPress={submitModal} loading={!!busy} fullWidth /></View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable onPress={() => setPreview(null)} style={styles.previewBg}>
          {preview && <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" />}
          <View style={styles.previewClose}><Ionicons name="close" size={22} color={colors.onSurfaceInverse} /></View>
        </Pressable>
      </Modal>
    </AdminShell>
  );
}

function StatCard({ icon, color, value, label }: any) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View>
        <Text style={type.metric}>{value}</Text>
        <Text style={type.small}>{label}</Text>
      </View>
    </View>
  );
}

function MetaCell({ label, value }: any) {
  return (
    <View style={styles.metaCell}>
      <Text style={type.label}>{label}</Text>
      <Text style={{ ...type.body, fontWeight: "600", marginTop: 2 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: spacing.md,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  statsRow: { gap: 8, paddingBottom: spacing.md },
  statCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10, ...shadow.sm,
    minWidth: 130,
  },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  filters: { flexDirection: "row", paddingBottom: spacing.md, gap: 6, flexWrap: "wrap" },
  filterTab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  filterTabActive: { backgroundColor: colors.brand },
  filterText: { ...type.small, fontWeight: "700", color: colors.onSurfaceMuted, fontSize: 11 },
  filterTextActive: { color: colors.onBrand },
  grid: { flexDirection: "column", marginHorizontal: -6 },
  truckCard: { marginBottom: spacing.md, padding: spacing.lg, gap: spacing.md },
  thumbBox: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  verifiedPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: colors.successLight, borderWidth: 1, borderColor: colors.success,
  },
  photo: {
    flex: 1, height: 100, borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  photoLbl: { ...type.small, color: colors.onSurfaceMuted },
  photoTag: { position: "absolute", top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 6 },
  photoTagTxt: { ...type.small, color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 10 },
  subBox: { flexDirection: "row", padding: 10, borderRadius: radius.md, backgroundColor: colors.brandLight },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", paddingTop: spacing.md, borderTopWidth: 1, borderColor: colors.divider, gap: 12 },
  metaCell: { width: "47%" },
  rejectBox: { flexDirection: "row", gap: 6, alignItems: "flex-start", padding: 10, backgroundColor: colors.errorLight, borderRadius: radius.md },
  actionsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", padding: spacing.lg, justifyContent: "center", alignItems: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, ...shadow.lg, width: "100%", maxWidth: 480 },
  previewBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center" },
  previewImg: { width: "100%", height: "80%" },
  previewClose: { position: "absolute", top: 50, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
});
