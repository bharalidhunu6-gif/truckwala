import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal, Alert, Linking } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Location from "expo-location";
import { useAuth } from "@/src/auth";
import { api, getToken } from "@/src/api";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button, Tag, inputStyle, Card } from "@/src/ui";
import { LiveMap } from "@/src/LiveMap";
import {
  startBackgroundTrip,
  stopBackgroundTrip,
  isBackgroundLocationSupported,
  isBackgroundTripActive,
} from "@/src/backgroundLocation";

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDriver = user?.role === "driver";

  const [b, setB] = useState<any>(null);
  const [pickupOtp, setPickupOtp] = useState("");
  const [deliveryOtp, setDeliveryOtp] = useState("");
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [rateDone, setRateDone] = useState(false);
  const [payHtml, setPayHtml] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [shipment, setShipment] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const [bgActive, setBgActive] = useState(false);
  const pollRef = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const x = await api.getBooking(id!);
      setB(x);
      if (x?.shipment_id) {
        try { const s = await api.getShipment(x.shipment_id); setShipment(s); } catch {}
      }
      // Sync bg indicator to actual task state
      setBgActive(await isBackgroundTripActive());
    } catch (e) { console.log(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Stop background tracking automatically when trip is delivered.
  useEffect(() => {
    if (b?.status === "delivered" && bgActive) {
      stopBackgroundTrip().then(() => setBgActive(false));
    }
  }, [b?.status, bgActive]);

  // Customer: poll driver location every 15s while trip is in_transit
  useEffect(() => {
    if (isDriver || !b || b.status !== "in_transit") {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { load(); }, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isDriver, b?.status, load]);

  const shareLocation = async () => {
    setSharing(true);
    try {
      // Foreground: one immediate ping so the customer sees a marker right away.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Location access is required to share your position with the customer.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.updateLocation(id!, loc.coords.latitude, loc.coords.longitude);
      await load();

      // Background: on a native/dev build, register the recurring task.
      if (isBackgroundLocationSupported()) {
        const token = await getToken();
        const res = await startBackgroundTrip(id!, token || "");
        if (res.ok) {
          setBgActive(true);
          Alert.alert("Live sharing on", "Your location will keep updating automatically until delivery.");
        } else if (res.reason === "background-denied") {
          Alert.alert("Background permission required", "Grant 'Allow all the time' in Settings for automatic tracking.");
        } else {
          Alert.alert("Location shared", "Your live location is now visible to the customer.");
        }
      } else {
        Alert.alert(
          "Location shared (one-time)",
          "Automatic background tracking needs a native build. Your position was updated once — tap again to refresh."
        );
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not fetch location");
    } finally {
      setSharing(false);
    }
  };

  const stopSharing = async () => {
    await stopBackgroundTrip();
    setBgActive(false);
    Alert.alert("Live sharing off", "Automatic location updates paused.");
  };

  const updateStatus = async (status: string, otp?: string) => {
    setProcessing(true);
    try { await api.setBookingStatus(id!, status, otp); await load(); }
    catch (e: any) { Alert.alert("Error", e.message); }
    finally { setProcessing(false); }
  };

  const startPay = async () => {
    setProcessing(true);
    try {
      const order = await api.createOrder(id!);
      if (order.mock_mode) {
        await api.verifyPayment({
          booking_id: id,
          razorpay_order_id: order.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock",
        });
        Alert.alert("Payment successful", "Booking paid (mock mode).");
        load();
        return;
      }
      setPayHtml(buildRzpHtml(order));
    } catch (e: any) { Alert.alert("Payment error", e.message); }
    finally { setProcessing(false); }
  };

  const onWebMessage = async (evt: any) => {
    try {
      const data = JSON.parse(evt.nativeEvent.data);
      if (data.type === "success") {
        await api.verifyPayment({
          booking_id: id,
          razorpay_order_id: data.order_id,
          razorpay_payment_id: data.payment_id,
          razorpay_signature: data.signature,
        });
        setPayHtml(null);
        load();
      } else if (data.type === "cancelled" || data.type === "error") {
        setPayHtml(null);
      }
    } catch {}
  };

  const submitRating = async () => {
    try { await api.rate({ booking_id: id, rating, review }); setRateDone(true); }
    catch (e: any) { Alert.alert("Error", e.message); }
  };

  if (!b) return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );

  const statusOrder = ["confirmed", "in_transit", "delivered"];
  const statusLabels: Record<string, string> = { confirmed: "Booking Confirmed", in_transit: "In Transit", delivered: "Delivered" };
  const currentIdx = statusOrder.indexOf(b.status);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={type.small}>Booking #{b.id.slice(0, 6)}</Text>
            <Text style={type.h3}>Trip Details</Text>
          </View>
          <Tag label={b.status.replace("_", " ")} tone={b.status === "delivered" ? "success" : b.status === "in_transit" ? "warning" : "brand"} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        {/* Big price banner */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <Card style={styles.priceBanner}>
            <View>
              <Text style={type.small}>Total Amount</Text>
              <Text style={styles.bigPrice}>₹{Math.round(b.price_inr).toLocaleString("en-IN")}</Text>
            </View>
            <Tag
              label={
                b.payment_method === "cod"
                  ? (b.payment_status === "paid_cod" ? "COD PAID" : "COD")
                  : (b.payment_status === "paid" ? "PAID" : "UNPAID")
              }
              tone={(b.payment_status === "paid" || b.payment_status === "paid_cod") ? "success" : b.payment_method === "cod" ? "warning" : "warning"}
              icon={(b.payment_status === "paid" || b.payment_status === "paid_cod") ? "checkmark-circle" : b.payment_method === "cod" ? "cash-outline" : "time-outline"}
            />
          </Card>
        </Animated.View>

        {/* Route */}
        <Animated.View entering={FadeInDown.delay(80).duration(400)}>
          <Card style={styles.routeCard}>
            <RoutePoint city={b.pickup_city} addr={b.pickup_address} label="PICKUP" color={colors.brand} />
            <View style={styles.routeLine} />
            <RoutePoint city={b.drop_city} addr={b.drop_address} label="DROP" color={colors.success} />
            <View style={styles.routeStrip}>
              <Ionicons name="navigate-outline" size={14} color={colors.onSurfaceDim} />
              <Text style={type.small}>{b.distance_km} km · ETA {b.eta_hours}h</Text>
            </View>
          </Card>
        </Animated.View>

        {/* Live map — visible once we have coords */}
        {shipment && (shipment.pickup_lat != null) && (
          <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
            <View style={styles.mapHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[styles.miniDot, { backgroundColor: colors.brand }]} />
                <Text style={type.small}>Pickup</Text>
                <View style={[styles.miniDot, { backgroundColor: colors.success, marginLeft: 10 }]} />
                <Text style={type.small}>Drop</Text>
                {b.current_lat != null && (
                  <>
                    <View style={[styles.miniDot, { backgroundColor: "#EA580C", marginLeft: 10 }]} />
                    <Text style={type.small}>Truck</Text>
                  </>
                )}
              </View>
              {b.location_updated_at ? (
                <Text style={type.small}>Updated {new Date(b.location_updated_at).toLocaleTimeString()}</Text>
              ) : (
                <Text style={type.small}>Not sharing</Text>
              )}
            </View>
            <LiveMap
              height={220}
              points={[
                { lat: shipment.pickup_lat, lng: shipment.pickup_lng, type: "pickup", label: b.pickup_city },
                { lat: shipment.drop_lat, lng: shipment.drop_lng, type: "drop", label: b.drop_city },
                ...(b.current_lat != null ? [{ lat: b.current_lat, lng: b.current_lng, type: "driver" as const, label: "Driver" }] : []),
              ]}
            />
          </Animated.View>
        )}

        {/* Truck / Party */}
        <Animated.View entering={FadeInDown.delay(160).duration(400)}>
          <Card style={styles.partyCard}>
            <View style={styles.partyRow}>
              <View style={styles.avatar}>
                <Text style={{ ...type.h3, color: colors.onBrand }}>
                  {(isDriver ? b.customer_name : b.driver_name)?.[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.small}>{isDriver ? "Shipper" : "Truck Operator"}</Text>
                <Text style={{ ...type.body, fontWeight: "700" }}>{isDriver ? b.customer_name : b.driver_name}</Text>
                {isDriver && b.customer_phone ? (
                  <Pressable
                    testID="call-customer"
                    onPress={() => Linking.openURL(`tel:${b.customer_phone}`).catch(() => Alert.alert("Cannot call", "Phone dialer unavailable."))}
                    hitSlop={8}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
                  >
                    <Ionicons name="call-outline" size={12} color={colors.brand} />
                    <Text style={{ ...type.small, color: colors.brand, fontWeight: "700", textDecorationLine: "underline" }}>{b.customer_phone}</Text>
                  </Pressable>
                ) : null}
              </View>
              {isDriver && b.customer_phone && (
                <Pressable
                  testID="call-customer-btn"
                  onPress={() => Linking.openURL(`tel:${b.customer_phone}`).catch(() => Alert.alert("Cannot call", "Phone dialer unavailable."))}
                  style={[styles.callBtn, { backgroundColor: colors.success + "20", borderColor: colors.success }]}
                >
                  <Ionicons name="call" size={18} color={colors.success} />
                </Pressable>
              )}
              <Pressable testID="open-chat-btn" onPress={() => router.push(`/chat/${b.id}`)} style={styles.callBtn}>
                <Ionicons name="chatbubbles-outline" size={18} color={colors.brand} />
              </Pressable>
            </View>
            <View style={styles.divider} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <Text style={type.small}>Vehicle</Text>
                <Text style={{ ...type.body, fontWeight: "600" }}>{b.truck_snapshot?.reg_number}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={type.small}>Type</Text>
                <Text style={{ ...type.body, fontWeight: "600" }}>{b.truck_snapshot?.truck_type}</Text>
              </View>
            </View>
          </Card>
        </Animated.View>

        {/* OTPs — visible ONLY to the shipper. Two codes: pickup + delivery. */}
        {!isDriver && (b.pickup_otp || b.delivery_otp) && (
          <Animated.View entering={FadeInDown.delay(240).duration(400)}>
            <Card style={styles.otpCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md }}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.brand} />
                <Text style={{ ...type.body, fontWeight: "700" }}>Your handover codes</Text>
              </View>
              <Text style={[type.small, { marginBottom: spacing.md }]}>
                Share <Text style={{ fontWeight: "700" }}>PICKUP</Text> code when the driver arrives to load,
                and <Text style={{ fontWeight: "700" }}>DELIVERY</Text> code only after goods arrive safely.
              </Text>

              <View style={styles.otpRow}>
                <View style={[styles.otpChip, { backgroundColor: colors.brandLight, borderColor: colors.brand }]}>
                  <View style={[styles.otpBadge, { backgroundColor: colors.brand }]}>
                    <Ionicons name="cube-outline" size={12} color={colors.onBrand} />
                  </View>
                  <Text style={styles.otpChipLabel}>PICKUP</Text>
                  <Text style={[styles.otpValue, { color: colors.brand }]} testID="pickup-otp">{b.pickup_otp}</Text>
                  {b.pickup_verified ? (
                    <View style={styles.otpDone}><Ionicons name="checkmark" size={12} color={colors.success} /><Text style={{ ...type.small, color: colors.success, fontWeight: "700" }}>Verified</Text></View>
                  ) : null}
                </View>
                <View style={[styles.otpChip, { backgroundColor: colors.successLight, borderColor: colors.success }]}>
                  <View style={[styles.otpBadge, { backgroundColor: colors.success }]}>
                    <Ionicons name="home-outline" size={12} color={colors.onBrand} />
                  </View>
                  <Text style={styles.otpChipLabel}>DELIVERY</Text>
                  <Text style={[styles.otpValue, { color: colors.success }]} testID="delivery-otp">{b.delivery_otp}</Text>
                  {b.delivery_verified ? (
                    <View style={styles.otpDone}><Ionicons name="checkmark" size={12} color={colors.success} /><Text style={{ ...type.small, color: colors.success, fontWeight: "700" }}>Verified</Text></View>
                  ) : null}
                </View>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* Driver-only card: OTP is NEVER shown, only entered. */}
        {isDriver && b.status !== "delivered" && b.status !== "cancelled" && (
          <Animated.View entering={FadeInDown.delay(240).duration(400)}>
            <Card style={styles.otpCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.otpIcon}><Ionicons name="shield-checkmark-outline" size={20} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, fontWeight: "700" }}>Secure handover</Text>
                  <Text style={type.small}>
                    Ask the shipper for the code at pickup and at delivery. You&apos;ll never see the codes yourself.
                  </Text>
                </View>
              </View>
            </Card>
          </Animated.View>
        )}

        {/* Timeline */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm }}>
          <Text style={type.h3}>Trip timeline</Text>
        </View>
        <Card style={{ marginHorizontal: spacing.lg, padding: spacing.lg }}>
          {statusOrder.map((s, i) => {
            const active = i <= currentIdx;
            const done = i < currentIdx;
            const timelineEntry = b.timeline?.find((t: any) => t.status === s);
            return (
              <View key={s} style={{ flexDirection: "row", marginBottom: i === statusOrder.length - 1 ? 0 : 14 }}>
                <View style={{ width: 28, alignItems: "center" }}>
                  <View style={[styles.tlDot, active ? { backgroundColor: colors.brand, borderColor: colors.brand } : { borderColor: colors.borderStrong }]}>
                    {done ? <Ionicons name="checkmark" size={12} color={colors.onBrand} /> : null}
                  </View>
                  {i < statusOrder.length - 1 && <View style={[styles.tlLine, active && { backgroundColor: colors.brand }]} />}
                </View>
                <View style={{ flex: 1, marginLeft: 12, paddingBottom: 4 }}>
                  <Text style={{ ...type.body, fontWeight: "700", color: active ? colors.onSurface : colors.onSurfaceDim }}>
                    {statusLabels[s]}
                  </Text>
                  {timelineEntry && (
                    <Text style={type.small}>{new Date(timelineEntry.at).toLocaleString()}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </Card>

        {/* Actions */}
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {isDriver && b.status === "confirmed" && (
            <Card style={styles.actionCard}>
              <Text style={[type.body, { fontWeight: "700", marginBottom: 8 }]}>Start pickup</Text>
              <Text style={[type.small, { marginBottom: spacing.md }]}>Ask the shipper for the 4-digit <Text style={{ fontWeight: "700" }}>PICKUP</Text> code.</Text>
              <TextInput
                testID="pickup-otp-input"
                value={pickupOtp}
                onChangeText={setPickupOtp}
                keyboardType="numeric"
                maxLength={4}
                placeholder="0000"
                placeholderTextColor={colors.onSurfaceDim}
                style={[inputStyle, { marginBottom: 12, letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: "700" }]}
              />
              <Button
                testID="start-trip-btn"
                label="Verify pickup & start trip"
                onPress={() => updateStatus("in_transit", pickupOtp)}
                loading={processing}
                leftIcon="play-circle-outline"
                fullWidth
              />
            </Card>
          )}
          {isDriver && b.status === "in_transit" && (
            <>
              <Button
                testID="share-location-btn"
                label={bgActive ? "Auto-sharing is ON" : (b.current_lat != null ? "Update / start auto-share" : "Share live location")}
                variant={bgActive ? "primary" : "secondary"}
                leftIcon={bgActive ? "radio" : "location-outline"}
                onPress={shareLocation}
                loading={sharing}
                fullWidth
              />
              {bgActive && (
                <Button
                  testID="stop-sharing-btn"
                  label="Stop auto-sharing"
                  variant="ghost"
                  leftIcon="stop-circle-outline"
                  onPress={stopSharing}
                  fullWidth
                />
              )}
              <Card style={styles.actionCard}>
                <Text style={[type.body, { fontWeight: "700", marginBottom: 8 }]}>Confirm delivery</Text>
                <Text style={[type.small, { marginBottom: spacing.md }]}>Ask the shipper for the 4-digit <Text style={{ fontWeight: "700" }}>DELIVERY</Text> code.</Text>
                <TextInput
                  testID="delivery-otp-input"
                  value={deliveryOtp}
                  onChangeText={setDeliveryOtp}
                  keyboardType="numeric"
                  maxLength={4}
                  placeholder="0000"
                  placeholderTextColor={colors.onSurfaceDim}
                  style={[inputStyle, { marginBottom: 12, letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: "700" }]}
                />
                <Button testID="complete-btn" label="Mark as delivered" onPress={() => updateStatus("delivered", deliveryOtp)} loading={processing} leftIcon="checkmark-done" fullWidth />
              </Card>
            </>
          )}
          {!isDriver && b.status !== "delivered" && b.status !== "cancelled" && b.payment_status !== "paid" && b.payment_method !== "cod" && (
            <Button testID="pay-btn" label={`Pay ₹${Math.round(b.price_inr).toLocaleString("en-IN")} via Razorpay`} onPress={startPay} loading={processing} leftIcon="card-outline" fullWidth />
          )}
          {b.payment_method === "cod" && b.status !== "delivered" && (
            <View style={styles.codBanner}>
              <Ionicons name="cash-outline" size={20} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.body, fontWeight: "700" }}>Cash on delivery</Text>
                <Text style={type.small}>Pay the driver ₹{Math.round(b.price_inr).toLocaleString("en-IN")} in cash on drop-off.</Text>
              </View>
            </View>
          )}
          {/* Cancel — either party, before pickup verified. */}
          {b.status !== "delivered" && b.status !== "cancelled" && !b.pickup_verified && (
            <Button
              testID="cancel-booking-btn"
              label="Cancel booking"
              variant="ghost"
              leftIcon="close-circle-outline"
              onPress={() =>
                Alert.alert(
                  "Cancel this booking?",
                  "This action cannot be undone. Cancellation is free before pickup.",
                  [
                    { text: "Keep booking", style: "cancel" },
                    { text: "Cancel booking", style: "destructive", onPress: async () => {
                      try { await api.cancelBooking(id!); await load(); }
                      catch (e: any) { Alert.alert("Error", e.message || "Could not cancel"); }
                    }},
                  ],
                )
              }
              fullWidth
            />
          )}
          {!isDriver && b.status !== "cancelled" && (
            <Button
              testID="report-driver-btn"
              label="Report an issue with this booking"
              variant="ghost"
              leftIcon="flag-outline"
              onPress={() => router.push(`/complaints/new?booking_id=${b.id}`)}
              fullWidth
            />
          )}
          {!isDriver && b.status === "delivered" && !rateDone && (
            <Card style={styles.actionCard}>
              <Text style={[type.body, { fontWeight: "700", marginBottom: 8 }]}>Rate this trip</Text>
              <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} testID={`star-${n}`}>
                    <Ionicons name={n <= rating ? "star" : "star-outline"} size={36} color={colors.warning} />
                  </Pressable>
                ))}
              </View>
              <TextInput value={review} onChangeText={setReview} placeholder="Share your experience (optional)..." placeholderTextColor={colors.onSurfaceDim} style={[inputStyle, { marginBottom: 12, minHeight: 60 }]} multiline />
              <Button testID="submit-rating-btn" label="Submit rating" onPress={submitRating} leftIcon="send" fullWidth />
            </Card>
          )}
          {rateDone && (
            <View style={styles.thanks}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <Text style={{ ...type.body, color: colors.success, fontWeight: "700" }}>Thanks for your rating!</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={!!payHtml} animationType="slide" onRequestClose={() => setPayHtml(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={{ flexDirection: "row", padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.divider, alignItems: "center", gap: 12 }}>
            <Pressable onPress={() => setPayHtml(null)} testID="close-pay">
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
            <Text style={type.h3}>Secure Payment</Text>
          </View>
          {payHtml && (
            <WebView originWhitelist={["*"]} source={{ html: payHtml }} onMessage={onWebMessage} javaScriptEnabled domStorageEnabled />
          )}
        </SafeAreaView>
      </Modal>
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

function buildRzpHtml(order: any) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><script src="https://checkout.razorpay.com/v1/checkout.js"></script></head><body style="margin:0;padding:0;background:#f7f8fa;color:#0b0f14;font-family:-apple-system,sans-serif"><div style="padding:20px">Opening Razorpay...</div><script>
    const rzp = new Razorpay({
      key: ${JSON.stringify(order.key_id)},
      amount: ${JSON.stringify(order.amount_paise)},
      currency: "INR",
      order_id: ${JSON.stringify(order.order_id)},
      name: "Truck Wala",
      description: "Booking Payment",
      prefill: { name: ${JSON.stringify(order.customer_name)}, email: ${JSON.stringify(order.customer_email)}, contact: ${JSON.stringify(order.customer_phone)} },
      theme: { color: "#0A5AF0" },
      handler: function (resp) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "success", order_id: resp.razorpay_order_id, payment_id: resp.razorpay_payment_id, signature: resp.razorpay_signature })); },
      modal: { ondismiss: function () { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "cancelled" })); } }
    });
    rzp.on('payment.failed', function (resp) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", error: resp.error })); });
    rzp.open();
  </script></body></html>`;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  priceBanner: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg,
    backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  bigPrice: { ...type.display, color: colors.onSurfaceInverse, marginTop: 4 },
  routeCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, gap: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, marginTop: 4 },
  routeLine: { width: 2, height: 20, backgroundColor: colors.borderStrong, marginLeft: 6 },
  routeStrip: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 12, borderTopWidth: 1, borderColor: colors.divider },
  partyCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg, gap: spacing.md },
  partyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  callBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: colors.divider },
  otpCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg },
  otpIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  otpValue: { ...type.display, fontSize: 26, letterSpacing: 4, color: colors.brand },
  otpRow: { flexDirection: "row", gap: 10 },
  otpChip: { flex: 1, padding: 12, borderRadius: radius.md, borderWidth: 1, alignItems: "center", gap: 6 },
  otpBadge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  otpChipLabel: { ...type.label, textTransform: "uppercase" as const, color: colors.onSurfaceMuted },
  otpDone: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 },
  codBanner: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md,
    backgroundColor: colors.warningLight, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.warning,
  },
  tlDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  tlLine: { width: 2, flex: 1, backgroundColor: colors.borderStrong, marginTop: 4, minHeight: 24 },
  actionCard: { padding: spacing.lg },
  thanks: { padding: spacing.lg, alignItems: "center", gap: 8, flexDirection: "row", justifyContent: "center", backgroundColor: colors.successLight, borderRadius: radius.md },
  mapHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 4 },
  miniDot: { width: 8, height: 8, borderRadius: 4 },
});
