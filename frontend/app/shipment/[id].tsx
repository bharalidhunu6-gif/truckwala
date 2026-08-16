import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Image, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button, Field, inputStyle, Tag, EmptyState, Card } from "@/src/ui";
import { BottomPicker, usePicker } from "@/src/pickers";
import { useNotificationSound } from "@/src/sound";
import { checkFakeGps, alertOnFakeGps } from "@/src/gpsGuard";

export default function ShipmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDriver = user?.role === "driver";

  const [shipment, setShipment] = useState<any>(null);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selTruck, setSelTruck] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const truckPicker = usePicker();
  const playSound = useNotificationSound();
  const prevQuoteCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const s = await api.getShipment(id!);
      setShipment(s);
      const qs = await api.shipmentQuotes(id!);
      if (!isDriver && qs.length > prevQuoteCount.current && prevQuoteCount.current > 0) {
        playSound("new");
      }
      prevQuoteCount.current = qs.length;
      setQuotes(qs);
      if (isDriver) {
        const t = await api.myTrucks();
        setTrucks(t);
        const approved = t.find((x: any) => x.verification_status === "approved");
        if (approved) setSelTruck(approved.id);
      }
    } finally { setLoading(false); }
  }, [id, isDriver, playSound]);
  useEffect(() => {
    load();
    // Poll for new quotes every 15s for customers
    if (!isDriver) {
      const t = setInterval(load, 15000);
      return () => clearInterval(t);
    }
  }, [load, isDriver]);

  const submitQuote = async () => {
    setErr("");
    if (!selTruck || !price || !eta) return setErr("Please select a truck, price and ETA");
    // Anti-spoof guard for drivers — block fake-GPS apps.
    const g = await checkFakeGps();
    if (!g.ok) {
      alertOnFakeGps(g);
      setErr(g.reason || "Fake GPS detected");
      return;
    }
    setSaving(true);
    try {
      await api.submitQuote({
        shipment_id: id,
        truck_id: selTruck,
        price_inr: parseFloat(price),
        eta_hours: parseFloat(eta),
        note,
      });
      setPrice(""); setEta(""); setNote("");

      const qs = await api.shipmentQuotes(id!);
      setQuotes(qs);
      Alert.alert("Quote submitted", "Your quote has been submitted successfully.");
    } catch (e: any) {
      if (e?.code === "subscription_required") {
        Alert.alert("Subscription required", e.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Subscribe", onPress: () => router.push(`/subscribe/${selTruck}`) },
        ]);
      } else {
        setErr(e.message);
      }
    } finally { setSaving(false); }
  };

  const accept = async (qid: string) => {
    setAccepting(qid);
    try {
      const b = await api.acceptQuote(qid, "cod");
      router.replace(`/booking/${b.id}`);
    } catch (e: any) { setErr(e.message); }
    finally { setAccepting(null); }
  };

  const promptPaymentAndAccept = (qid: string) => {
    Alert.alert(
      "Confirm booking?",
      "All Truck Wala bookings are cash on delivery — pay the driver directly when your goods arrive.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm & book", onPress: () => accept(qid) },
      ],
    );
  };

  if (loading || !shipment) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  const selTruckObj = trucks.find((t) => t.id === selTruck);
  const canQuote = selTruckObj && selTruckObj.verification_status === "approved";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={type.small}>Shipment #{shipment.id.slice(0, 6)}</Text>
            <Text style={type.h3}>Details</Text>
          </View>
          <Tag label={shipment.status.replace("_", " ")} tone={shipment.status === "open" ? "brand" : "success"} />
        </View>
      </SafeAreaView>

      <View style={{ flex: 1 }}>
  <ScrollView
    style={{ flex: 1 }}
    contentContainerStyle={{
      paddingBottom: insets.bottom + 150,
    }}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
    showsVerticalScrollIndicator={true}
    nestedScrollEnabled={true}
    scrollEnabled={true}
  >
          {/* Route card */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <Card style={styles.routeCard}>
              <RoutePoint city={shipment.pickup_city} addr={shipment.pickup_address} label="PICKUP" color={colors.brand} />
              <View style={styles.routeLine} />
              <RoutePoint city={shipment.drop_city} addr={shipment.drop_address} label="DROP" color={colors.success} />
            </Card>
          </Animated.View>

          {/* Metrics */}
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.metricsRow}>
            <MetricBox icon="scale-outline" value={`${shipment.weight_kg}`} unit="kg" label="Weight" />
            <MetricBox icon="cube-outline" value={String(shipment.packages)} unit="" label="Packages" />
            <MetricBox icon="navigate-outline" value={String(shipment.distance_km)} unit="km" label="Distance" />
          </Animated.View>

          {/* Details */}
          <Animated.View entering={FadeInDown.delay(160).duration(400)}>
            <Card style={styles.detailCard}>
              <DetailRow icon="pricetag-outline" label="Goods" value={shipment.goods_category} />
              <DetailRow icon="car-outline" label="Preferred truck" value={shipment.truck_type_preferred || "Any truck"} />
              <DetailRow icon="calendar-outline" label="Loading date" value={shipment.loading_date} />
              {shipment.instructions ? <DetailRow icon="chatbox-outline" label="Instructions" value={shipment.instructions} /> : null}
            </Card>
          </Animated.View>

          {shipment.photos?.length > 0 && (
            <Animated.View entering={FadeInDown.delay(200).duration(400)}>
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm }}>
                <Text style={type.h3}>Photos ({shipment.photos.length})</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 10 }}>
                {shipment.photos.map((p: string, i: number) => (
                  <Image key={i} source={{ uri: p }} style={styles.photoThumb} />
                ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* Driver quote form */}
          {isDriver && shipment.status === "open" && (
            <Animated.View entering={FadeInDown.delay(240).duration(400)}>
              <View style={styles.section}>
                <Text style={[type.h3, { marginBottom: spacing.md }]}>Submit your quote</Text>

                {/* Anti-fake-bidding warning banner */}
                <View style={styles.warnBanner}>
                  <Ionicons name="warning" size={18} color={colors.error} />
                  <Text style={styles.warnText}>
                    <Text style={{ fontWeight: "800" }}>⚠️ Fair bidding notice:</Text>{" "}
                    Drivers found submitting fake bids to win auctions and then cancelling — or spoofing GPS — will be <Text style={{ fontWeight: "800" }}>permanently banned</Text> from the app.
                  </Text>
                </View>

                {trucks.length === 0 ? (
                  <EmptyState icon="car-outline" title="No trucks yet" subtitle="Register a truck first to submit quotes." />
                ) : !canQuote ? (
                  <View style={styles.notice}>
                    <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                    <Text style={styles.noticeText}>
                      {selTruckObj?.verification_status === "pending"
                        ? "This truck is awaiting admin verification. You can submit quotes once it's approved."
                        : "This truck was rejected. Please pick another truck or contact admin."}
                    </Text>
                  </View>
                ) : null}
                <Field label="Truck">
                  <Pressable onPress={truckPicker.open} testID="pick-quote-truck" style={styles.selectRow}>
                    <Text style={{ ...type.body, color: selTruckObj ? colors.onSurface : colors.onSurfaceDim, flex: 1 }}>
                      {selTruckObj ? `${selTruckObj.reg_number} · ${selTruckObj.truck_type}` : "Choose your truck"}
                    </Text>
                    <Ionicons name="chevron-down" size={18} color={colors.onSurfaceDim} />
                  </Pressable>
                </Field>
                <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Price (INR)">
                      <TextInput testID="quote-price" value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="12000" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                    </Field>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="ETA (hours)">
                      <TextInput testID="quote-eta" value={eta} onChangeText={setEta} keyboardType="numeric" placeholder="8" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                    </Field>
                  </View>
                </View>
                <Field label="Note (optional)">
                  <TextInput value={note} onChangeText={setNote} placeholder="Available immediately" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="submit-quote-btn" label="Submit quote" onPress={submitQuote} loading={saving} disabled={!canQuote} leftIcon="send" fullWidth />
              </View>
            </Animated.View>
          )}

          {/* Quotes list */}
          <View style={styles.quotesHeader}>
            <Text style={type.h3}>Quotations</Text>
            <Text style={type.small}>{quotes.length} received</Text>
          </View>
          {quotes.length === 0 ? (
            <EmptyState icon="mail-outline" title="No quotes yet" subtitle="Waiting for operators to submit prices." />
          ) : (
            quotes.map((q, idx) => {
              const isMine = user?.role === "driver" && (q.is_mine === true || q.driver_id === user.id);
              const isAnon = user?.role === "driver" && !isMine;
              return (
                <Animated.View key={q.id} entering={FadeInDown.delay(idx * 60).duration(300)}>
                  <Card style={styles.quoteCard} testID={`quote-${q.id}`}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.qprice}>₹{Math.round(q.price_inr).toLocaleString("en-IN")}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <View style={styles.driverAvatar}>
                            <Text style={{ ...type.small, color: colors.onBrand, fontWeight: "700" }}>{(q.driver_name || "?")[0]?.toUpperCase()}</Text>
                          </View>
                          <Text style={{ ...type.body, fontWeight: "600" }}>{isAnon ? "Competing operator" : q.driver_name}</Text>
                        </View>
                      </View>
                      {isMine && <Tag label="Your quote" tone="brand" />}
                      {isAnon && <Tag label="Rival bid" tone="default" />}
                      {q.status !== "pending" && !isMine && !isAnon && <Tag label={q.status} tone={q.status === "accepted" ? "success" : "error"} />}
                    </View>
                    <View style={styles.qStrip}>
                      <View style={styles.qMet}>
                        <Ionicons name="time-outline" size={13} color={colors.onSurfaceDim} />
                        <Text style={styles.qMetTxt}>ETA {q.eta_hours}h</Text>
                      </View>
                      {q.truck_snapshot?.reg_number ? (
                        <View style={styles.qMet}>
                          <Ionicons name="car-outline" size={13} color={colors.onSurfaceDim} />
                          <Text style={styles.qMetTxt}>{q.truck_snapshot.reg_number}</Text>
                        </View>
                      ) : null}
                      {q.truck_snapshot?.load_capacity_kg ? (
                        <View style={styles.qMet}>
                          <Ionicons name="scale-outline" size={13} color={colors.onSurfaceDim} />
                          <Text style={styles.qMetTxt}>{q.truck_snapshot.load_capacity_kg}kg</Text>
                        </View>
                      ) : null}
                    </View>
                    {q.note ? <Text style={styles.qnote}>&ldquo;{q.note}&rdquo;</Text> : null}
                    {!isDriver && q.status === "pending" && shipment.status === "open" && (
                      <Button testID={`accept-quote-${q.id}`} label="Accept & book" onPress={() => promptPaymentAndAccept(q.id)} loading={accepting === q.id} leftIcon="checkmark-circle-outline" style={{ marginTop: spacing.sm }} fullWidth />
                    )}
                  </Card>
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      </View>

      <BottomPicker
        sheetRef={truckPicker.ref}
        title="Choose your truck"
        value={selTruck}
        onChange={setSelTruck}
        items={trucks.map((t: any) => ({
          value: t.id,
          label: `${t.reg_number} · ${t.truck_type} (${t.verification_status || "pending"})`,
          icon: t.verification_status === "approved" ? "checkmark-circle-outline" : t.verification_status === "rejected" ? "close-circle-outline" : "time-outline",
        }))}
      />
    </View>
  );
}

function RoutePoint({ city, addr, label, color }: any) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.onSurfaceDim }]}>{label}</Text>
        <Text style={{ ...type.h3, marginTop: 2 }}>{city}</Text>
        <Text style={type.bodyMuted} numberOfLines={2}>{addr}</Text>
      </View>
    </View>
  );
}

function MetricBox({ icon, value, unit, label }: any) {
  return (
    <View style={styles.metricBox}>
      <Ionicons name={icon} size={18} color={colors.brand} />
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 6 }}>
        <Text style={type.metric}>{value}</Text>
        {unit ? <Text style={type.small}>{unit}</Text> : null}
      </View>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value }: any) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}><Ionicons name={icon} size={16} color={colors.brand} /></View>
      <View style={{ flex: 1 }}>
        <Text style={type.small}>{label}</Text>
        <Text style={{ ...type.body, marginTop: 2, fontWeight: "600" }}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  routeCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 4 },
  routeLine: { width: 2, height: 20, backgroundColor: colors.borderStrong, marginLeft: 6 },
  metricsRow: { flexDirection: "row", gap: 10, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  metricBox: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: "flex-start", ...shadow.sm },
  detailCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, gap: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  detailIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  section: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm,
  },
  selectRow: { height: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: spacing.md, backgroundColor: colors.warningLight, borderRadius: radius.md, marginBottom: spacing.md },
  noticeText: { ...type.small, color: "#92400E", flex: 1 },
  warnBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: spacing.md, backgroundColor: colors.errorLight,
    borderWidth: 1, borderColor: colors.error, borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  warnText: { ...type.small, color: colors.error, flex: 1, lineHeight: 18 },
  err: { ...type.small, color: colors.error, textAlign: "center", padding: spacing.md, backgroundColor: colors.errorLight, borderRadius: radius.md, marginBottom: spacing.md },
  quotesHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  quoteCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, gap: spacing.md },
  qprice: { ...type.display, fontSize: 26 },
  driverAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  qStrip: { flexDirection: "row", gap: 16, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider },
  qMet: { flexDirection: "row", alignItems: "center", gap: 4 },
  qMetTxt: { ...type.small, color: colors.onSurface, fontWeight: "600" },
  qnote: { ...type.small, fontStyle: "italic", color: colors.onSurfaceMuted },
  photoThumb: { width: 120, height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
});
