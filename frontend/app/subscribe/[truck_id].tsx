import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button, Card, Tag } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { api } from "@/src/api";

export default function SubscribeScreen() {
  const insets = useSafeAreaInsets();
  const { truck_id } = useLocalSearchParams<{ truck_id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payHtml, setPayHtml] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Load tiers independently so the list still renders even if truck lookup fails.
    api.subTiers().then(setTiers).catch(() => setTiers([]));
    try {
      const s = await api.truckSubStatus(truck_id!);
      setStatus(s);
    } catch (e: any) {
      setStatus(null);
    } finally { setLoading(false); }
  }, [truck_id]);
  useEffect(() => { load(); }, [load]);

  const startPay = async () => {
    setBusy(true);
    try {
      const order = await api.subOrder(truck_id!);
      setSubId(order.subscription_id);
      if (order.mock_mode) {
        // In mock mode, verify immediately to activate the subscription — no
        // Razorpay checkout needed.
        await api.subVerify({
          truck_id,
          subscription_id: order.subscription_id,
          razorpay_order_id: order.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock",
        });
        Alert.alert("Subscription active", "Your plan has been activated in mock mode.");
        load();
        return;
      }
      setPayHtml(buildRzpHtml(order));
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not start payment");
    } finally { setBusy(false); }
  };

  const onWebMessage = async (e: any) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "success") {
        await api.subVerify({
          truck_id,
          subscription_id: subId,
          razorpay_order_id: data.order_id,
          razorpay_payment_id: data.payment_id,
          razorpay_signature: data.signature,
        });
        setPayHtml(null);
        Alert.alert("🎉 Subscription active", "You can now start accepting bookings.");
        load();
      } else if (data.type === "cancelled") {
        setPayHtml(null);
      } else if (data.type === "error") {
        setPayHtml(null);
        Alert.alert("Payment failed", data.error?.description || "Please try again");
      }
    } catch (err: any) {
      setPayHtml(null);
      Alert.alert("Error", err.message || "Payment verification failed");
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>;
  }

  const activeTier = status?.tier || (tiers?.[0] ?? null);
  const active = !!status?.active;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.header}>
          <Pressable testID="sub-back" onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={type.small}>Bidding subscription</Text>
            <Text style={type.h2}>{status?.reg_number || "Vehicle"}</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
        {/* Current status */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <Card style={active ? styles.activeBanner : styles.expiredBanner}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={[styles.bigIcon, { backgroundColor: active ? colors.success : colors.warning }]}>
                <Ionicons name={active ? "shield-checkmark" : "shield-outline"} size={22} color={colors.onBrand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.h3, color: active ? colors.success : colors.warning }}>
                  {active ? "Subscription Active" : "Not Subscribed"}
                </Text>
                {status?.expires_at ? (
                  <Text style={type.small}>
                    {active ? "Renews on " : "Expired on "}
                    {new Date(status.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                  </Text>
                ) : (
                  <Text style={type.small}>Subscribe to submit quotes on shipments</Text>
                )}
              </View>
            </View>
          </Card>
        </Animated.View>

        {/* Warning banner */}
        <View style={styles.warnBox}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={{ ...type.small, color: colors.onSurface, flex: 1 }}>
            You need an active subscription for this vehicle to submit quotes and go online. All shippers pay in <Text style={{ fontWeight: "700" }}>cash on delivery</Text>.
          </Text>
        </View>

        {/* Available tiers */}
        <Text style={[type.h3, { marginTop: spacing.md }]}>Choose your plan</Text>
        {tiers.map((tier, idx) => {
          const applicable = tier.id === activeTier?.id;
          return (
            <Animated.View key={tier.id} entering={FadeInDown.delay(120 + idx * 60).duration(300)}>
              <Card style={[styles.tierCard, applicable && styles.tierCardActive]}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <View style={styles.priceCol}>
                    <Text style={styles.priceUnit}>₹</Text>
                    <Text style={styles.priceValue}>{tier.amount_inr}</Text>
                    <Text style={styles.pricePer}>/month</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ ...type.h3, flex: 1 }}>{tier.title.replace(/\s*\(₹.*\)/, "")}</Text>
                      {applicable && <Tag label="Your tier" tone="brand" icon="checkmark" />}
                    </View>
                    <Text style={type.small}>{tier.description}</Text>
                    <View style={{ marginTop: 8, gap: 4 }}>
                      {(tier.examples || []).slice(0, 5).map((ex: string) => (
                        <View key={ex} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Ionicons name="ellipse" size={4} color={colors.onSurfaceMuted} />
                          <Text style={{ ...type.small, color: colors.onSurfaceMuted }}>{ex}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </Card>
            </Animated.View>
          );
        })}

        <Button
          testID="sub-pay-btn"
          label={active ? `Renew (₹${activeTier?.amount_inr}/month)` : `Subscribe now — ₹${activeTier?.amount_inr}/month`}
          onPress={startPay}
          loading={busy}
          leftIcon="card-outline"
          fullWidth
          style={{ marginTop: spacing.md }}
        />

        <Text style={[type.small, { textAlign: "center", marginTop: 8, color: colors.onSurfaceMuted }]}>
          Payments are processed securely via Razorpay. Your subscription auto-adjusts based on your vehicle&apos;s GVW.
        </Text>
      </ScrollView>

      {payHtml && (
        <View style={styles.payOverlay}>
          <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
            <View style={styles.header}>
              <Pressable onPress={() => setPayHtml(null)} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
              <Text style={type.h3}>Complete payment</Text>
            </View>
          </SafeAreaView>
          <WebView originWhitelist={["*"]} source={{ html: payHtml }} onMessage={onWebMessage} javaScriptEnabled domStorageEnabled />
        </View>
      )}
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
      description: ${JSON.stringify(order.tier.title + " — " + order.truck.reg_number)},
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  activeBanner: { padding: spacing.lg, backgroundColor: colors.successLight, borderColor: colors.success },
  expiredBanner: { padding: spacing.lg, backgroundColor: colors.warningLight, borderColor: colors.warning },
  bigIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  warnBox: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.warningLight, borderWidth: 1, borderColor: colors.warning,
  },
  tierCard: { padding: spacing.lg, borderWidth: 2, borderColor: colors.border },
  tierCardActive: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  priceCol: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6, minWidth: 90 },
  priceUnit: { ...type.body, color: colors.onSurfaceMuted, fontWeight: "700" },
  priceValue: { fontSize: 38, fontWeight: "800", color: colors.onSurface, lineHeight: 42 },
  pricePer: { ...type.small, color: colors.onSurfaceMuted },
  payOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, ...shadow.lg,
  },
});
