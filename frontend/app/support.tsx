import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button, Card } from "@/src/ui";

export const CUSTOMER_CARE_PHONE = "+917002597575";

export default function Support() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const call = () => {
    Linking.openURL(`tel:${CUSTOMER_CARE_PHONE}`).catch(() =>
      Alert.alert("Unable to place call", CUSTOMER_CARE_PHONE)
    );
  };
  const sms = () => {
    Linking.openURL(`sms:${CUSTOMER_CARE_PHONE}`).catch(() => {});
  };
  const whatsapp = () => {
    Linking.openURL(`https://wa.me/${CUSTOMER_CARE_PHONE.replace(/[^0-9]/g, "")}`).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={s.hdr}>
          <Pressable onPress={() => router.back()} testID="support-back" style={s.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={type.h3}>Customer Support</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        <Card style={s.hero}>
          <View style={s.phoneIcon}>
            <Ionicons name="headset" size={28} color={colors.onBrand} />
          </View>
          <Text style={[type.small, { marginTop: spacing.md }]}>24 × 7 helpline</Text>
          <Text testID="support-phone" style={s.phoneText}>{CUSTOMER_CARE_PHONE}</Text>
          <Text style={[type.bodyMuted, { textAlign: "center", marginTop: 4 }]}>
            We're here to help with bookings, payments, and driver support.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}><Button testID="support-call" label="Call" leftIcon="call" onPress={call} fullWidth /></View>
            <View style={{ flex: 1 }}><Button testID="support-sms" label="SMS" leftIcon="chatbox-outline" variant="secondary" onPress={sms} fullWidth /></View>
            <View style={{ flex: 1 }}><Button testID="support-wa" label="WhatsApp" leftIcon="logo-whatsapp" variant="secondary" onPress={whatsapp} fullWidth /></View>
          </View>
        </Card>

        <Text style={[type.h3, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>Frequently asked</Text>
        <Card style={s.faq}>
          <Text style={s.q}>How do I get paid?</Text>
          <Text style={s.a}>Payments settle to your registered bank account within 48 hours of successful delivery.</Text>
        </Card>
        <Card style={s.faq}>
          <Text style={s.q}>Why is my truck pending?</Text>
          <Text style={s.a}>All trucks are verified by our admin before you can accept quotes. Typical turnaround: 4–12 working hours.</Text>
        </Card>
        <Card style={s.faq}>
          <Text style={s.q}>My shipment expired</Text>
          <Text style={s.a}>Open shipments auto-close after 72 hours if no driver is booked. Post again to try new operators.</Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  hero: { padding: spacing.xl, alignItems: "center" },
  phoneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", ...shadow.md },
  phoneText: { ...type.display, fontSize: 26, color: colors.brand, marginTop: 4, letterSpacing: 1 },
  faq: { padding: spacing.lg, marginBottom: spacing.md },
  q: { ...type.body, fontWeight: "700", marginBottom: 4 },
  a: { ...type.bodyMuted },
});
