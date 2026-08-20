import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  ActivityIndicator,
} from "react-native";
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
  const [orderId, setOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    api.subTiers()
      .then(setTiers)
      .catch(() => setTiers([]));

    try {
      const s = await api.truckSubStatus(truck_id!);
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [truck_id]);

  useEffect(() => {
    load();
  }, [load]);

  // =========================
  // START CASHFREE PAYMENT
  // =========================

  const startPay = async () => {
    if (!truck_id) {
      Alert.alert("Error", "Truck ID missing");
      return;
    }

    setBusy(true);

    try {
      const order = await api.subOrder(truck_id);

      setSubId(order.subscription_id);
      setOrderId(order.order_id);

      // =========================
      // MOCK MODE
      // =========================

      if (order.mock_mode) {
        await api.subVerify({
          truck_id,
          subscription_id: order.subscription_id,
          order_id: order.order_id,
        });

        Alert.alert(
          "Subscription active",
          "Your subscription has been activated in mock mode."
        );

        await load();
        return;
      }

      // =========================
      // CASHFREE CHECKOUT
      // =========================

      if (!order.payment_session_id) {
        throw new Error("Cashfree payment session not received");
      }

      setPayHtml(
        buildCashfreeHtml({
          paymentSessionId: order.payment_session_id,
          environment: order.cashfree_env || "production",
        })
      );
    } catch (e: any) {
      Alert.alert(
        "Payment Error",
        e?.message || "Could not start subscription payment"
      );
    } finally {
      setBusy(false);
    }
  };

  // =========================
  // CASHFREE WEBVIEW MESSAGE
  // =========================
const verifySubscription = async () => {
  if (!truck_id || !subId || !orderId) {
    Alert.alert(
      "Error",
      "Subscription order information missing."
    );
    return;
  }

  try {
    // Cashfree may take a few seconds to update
    // the payment status. Retry verification.
    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await api.subVerify({
        truck_id,
        subscription_id: subId,
        order_id: orderId,
      });

      if (result?.ok) {
        setPayHtml(null);

        Alert.alert(
          "🎉 Subscription Active",
          "Your subscription is active for 30 days. You can now submit quotes."
        );

        await load();
        return;
      }

      // Wait 2 seconds before checking again
      await new Promise((resolve) =>
        setTimeout(resolve, 2000)
      );
    }

    setPayHtml(null);

    Alert.alert(
      "Payment Pending",
      "Payment was received, but Cashfree is still confirming it. Please check again shortly."
    );
  } catch (err: any) {
    setPayHtml(null);

    Alert.alert(
      "Payment Verification Failed",
      err?.message ||
        "Could not verify the Cashfree payment."
    );
  }
};
  const onWebMessage = async (e: any) => {
  try {
    const data = JSON.parse(e.nativeEvent.data);

    if (data.type === "error") {
      setPayHtml(null);

      Alert.alert(
        "Payment failed",
        data.error ||
          "Cashfree payment could not be completed."
      );

      return;
    }

    if (data.type === "cancelled") {
      setPayHtml(null);
      return;
    }

    if (data.type === "payment_finished") {
      await verifySubscription();
      return;
    }
  } catch (err: any) {
    setPayHtml(null);

    Alert.alert(
      "Error",
      err?.message ||
        "Unable to process payment response."
    );
  }
};

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const activeTier = status?.tier || tiers?.[0] || null;
  const active = !!status?.active;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView
        edges={["top"]}
        style={{ backgroundColor: colors.surface }}
      >
        <View style={styles.header}>
          <Pressable
            testID="sub-back"
            onPress={() => router.back()}
            style={styles.iconBtn}
          >
            <Ionicons
              name="arrow-back"
              size={22}
              color={colors.onSurface}
            />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={type.small}>Bidding subscription</Text>
            <Text style={type.h2}>
              {status?.reg_number || "Vehicle"}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + 40,
          gap: spacing.md,
        }}
      >
        {/* Current status */}
        <Animated.View entering={FadeInDown.duration(300)}>
          <Card
            style={
              active
                ? styles.activeBanner
                : styles.expiredBanner
            }
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <View
                style={[
                  styles.bigIcon,
                  {
                    backgroundColor: active
                      ? colors.success
                      : colors.warning,
                  },
                ]}
              >
                <Ionicons
                  name={
                    active
                      ? "shield-checkmark"
                      : "shield-outline"
                  }
                  size={22}
                  color={colors.onBrand}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    ...type.h3,
                    color: active
                      ? colors.success
                      : colors.warning,
                  }}
                >
                  {active
                    ? "Subscription Active"
                    : "Not Subscribed"}
                </Text>

                {status?.expires_at ? (
                  <Text style={type.small}>
                    {active ? "Valid until " : "Expired on "}
                    {new Date(
                      status.expires_at
                    ).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </Text>
                ) : (
                  <Text style={type.small}>
                    Subscribe to submit quotes on shipments
                  </Text>
                )}
              </View>
            </View>
          </Card>
        </Animated.View>

        {/* Warning */}
        <View style={styles.warnBox}>
          <Ionicons
            name="warning-outline"
            size={16}
            color={colors.warning}
          />

          <Text
            style={{
              ...type.small,
              color: colors.onSurface,
              flex: 1,
            }}
          >
            You need an active subscription for this vehicle
            to submit quotes and go online. All shippers pay
            in{" "}
            <Text style={{ fontWeight: "700" }}>
              cash on delivery
            </Text>
            .
          </Text>
        </View>

        {/* Plans */}
        <Text
          style={[
            type.h3,
            { marginTop: spacing.md },
          ]}
        >
          Choose your plan
        </Text>

        {tiers.map((tier, idx) => {
          const applicable =
            tier.id === activeTier?.id;

          return (
            <Animated.View
              key={tier.id}
              entering={FadeInDown
                .delay(120 + idx * 60)
                .duration(300)}
            >
             <Card
  style={{
    ...styles.tierCard,
    ...(applicable ? styles.tierCardActive : {}),
  }}
>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <View style={styles.priceCol}>
                    <Text style={styles.priceUnit}>
                      ₹
                    </Text>

                    <Text style={styles.priceValue}>
                      {tier.amount_inr}
                    </Text>

                    <Text style={styles.pricePer}>
                      /month
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Text
                        style={{
                          ...type.h3,
                          flex: 1,
                        }}
                      >
                        {tier.title.replace(
                          /\s*\(₹.*\)/,
                          ""
                        )}
                      </Text>

                      {applicable && (
                        <Tag
                          label="Your tier"
                          tone="brand"
                          icon="checkmark"
                        />
                      )}
                    </View>

                    <Text style={type.small}>
                      {tier.description}
                    </Text>

                    <View
                      style={{
                        marginTop: 8,
                        gap: 4,
                      }}
                    >
                      {(tier.examples || [])
                        .slice(0, 5)
                        .map((ex: string) => (
                          <View
                            key={ex}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <Ionicons
                              name="ellipse"
                              size={4}
                              color={
                                colors.onSurfaceMuted
                              }
                            />

                            <Text
                              style={{
                                ...type.small,
                                color:
                                  colors.onSurfaceMuted,
                              }}
                            >
                              {ex}
                            </Text>
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
          label={
            active
              ? `Renew (₹${activeTier?.amount_inr}/month)`
              : `Subscribe now — ₹${activeTier?.amount_inr}/month`
          }
          onPress={startPay}
          loading={busy}
          leftIcon="card-outline"
          fullWidth
          style={{ marginTop: spacing.md }}
        />

        <Text
          style={[
            type.small,
            {
              textAlign: "center",
              marginTop: 8,
              color: colors.onSurfaceMuted,
            },
          ]}
        >
          Payments are processed securely via Cashfree.
          Your subscription is activated after the server
          confirms the payment.
        </Text>
      </ScrollView>

      {/* =========================
          CASHFREE PAYMENT WEBVIEW
         ========================= */}

      {payHtml && (
        <View style={styles.payOverlay}>
          <SafeAreaView
            edges={["top"]}
            style={{
              backgroundColor: colors.surface,
            }}
          >
            <View style={styles.header}>
              <Pressable
                onPress={() => setPayHtml(null)}
                style={styles.iconBtn}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={colors.onSurface}
                />
              </Pressable>

              <Text style={type.h3}>
                Complete payment
              </Text>
            </View>
          </SafeAreaView>

          <WebView
            originWhitelist={["*"]}
            source={{ html: payHtml }}
            onMessage={onWebMessage}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            startInLoadingState
          />
        </View>
      )}
    </View>
  );
}


// =====================================================
// CASHFREE CHECKOUT HTML
// =====================================================

function buildCashfreeHtml({
  paymentSessionId,
  environment,
}: {
  paymentSessionId: string;
  environment: string;
}) {
  const mode =
    environment?.toLowerCase() === "sandbox"
      ? "sandbox"
      : "production";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  />

  <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>

  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #f7f8fa;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 16px;
      color: #555;
    }
  </style>
</head>

<body>
  <div class="loading">
    Opening Cashfree secure checkout...
  </div>

  <script>
    const paymentSessionId =
      ${JSON.stringify(paymentSessionId)};

    const mode =
      ${JSON.stringify(mode)};

    function sendMessage(payload) {
      if (
        window.ReactNativeWebView &&
        window.ReactNativeWebView.postMessage
      ) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify(payload)
        );
      }
    }

    async function startCashfree() {
      try {
        if (!paymentSessionId) {
          throw new Error(
            "Cashfree payment session is missing"
          );
        }

        const cashfree = Cashfree({
          mode: mode
        });

        const result = await cashfree.checkout({
          paymentSessionId: paymentSessionId,
          redirectTarget: "_self"
        });

        // Cashfree popup/inline checkout returns
        // a promise after the payment attempt.
        if (result && result.error) {
          sendMessage({
            type: "error",
            error:
              result.error.message ||
              "Cashfree checkout failed"
          });
          return;
        }

        // IMPORTANT:
        // Do not trust client-side payment success.
        // React Native will call the backend and the backend
        // will verify the Cashfree order status.
        sendMessage({
          type: "payment_finished"
        });

      } catch (error) {
        sendMessage({
          type: "error",
          error:
            error?.message ||
            "Unable to open Cashfree checkout"
        });
      }
    }

    window.addEventListener(
      "load",
      startCashfree
    );
  </script>
</body>
</html>
`;
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },

  activeBanner: {
    padding: spacing.lg,
    backgroundColor: colors.successLight,
    borderColor: colors.success,
  },

  expiredBanner: {
    padding: spacing.lg,
    backgroundColor: colors.warningLight,
    borderColor: colors.warning,
  },

  bigIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  warnBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
    borderWidth: 1,
    borderColor: colors.warning,
  },

  tierCard: {
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },

  tierCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },

  priceCol: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    minWidth: 90,
  },

  priceUnit: {
    ...type.body,
    color: colors.onSurfaceMuted,
    fontWeight: "700",
  },

  priceValue: {
    fontSize: 38,
    fontWeight: "800",
    color: colors.onSurface,
    lineHeight: 42,
  },

  pricePer: {
    ...type.small,
    color: colors.onSurfaceMuted,
  },

  payOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    ...shadow.lg,
  },
});