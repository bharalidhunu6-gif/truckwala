import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type, radius } from "@/src/theme";
import { Card } from "@/src/ui";

const SECTIONS: { t: string; b: string }[] = [
  { t: "1. Acceptance of Terms", b: "By creating an account or using Truck Wala you agree to be bound by these Terms & Conditions. If you do not agree, do not use the service." },
  { t: "2. Eligibility", b: "You must be at least 18 years old and legally capable of entering a binding contract in your jurisdiction. Truck operators must hold valid vehicle and driving documentation." },
  { t: "3. Roles", b: "Truck Wala is a marketplace that connects shippers (customers) with independent truck operators. Truck Wala is NOT a carrier and does not take ownership of any goods in transit." },
  { t: "4. Booking & Payments", b: "Prices are quoted by operators and accepted by shippers. Payments are processed via Razorpay. Truck Wala charges a service fee that is disclosed at checkout. Cancellations after acceptance may attract fees as displayed in the booking." },
  { t: "5. Delivery & OTP", b: "Every booking generates a 4-digit delivery OTP visible to the shipper. Handing the OTP to the driver is the shipper's confirmation of receipt and closes the trip." },
  { t: "6. Verification", b: "Truck operators must complete document verification before they can submit quotes. Truck Wala reserves the right to reject or suspend any operator whose documents are incomplete, forged, or expired." },
  { t: "7. Prohibited Goods", b: "Illegal, hazardous, restricted or prohibited items (as defined by applicable law) must not be shipped through Truck Wala. Violations may result in permanent suspension and reporting to authorities." },
  { t: "8. Ratings & Reviews", b: "Both parties may rate a trip once after successful delivery. Ratings must be honest, not defamatory, and free of personal or contact information." },
  { t: "9. Data & Privacy", b: "We collect only the data required to operate the marketplace (name, email, phone, location while on trip, payment metadata). Data is stored securely and not sold to third parties." },
  { t: "10. Liability", b: "Truck Wala's aggregate liability under any circumstance is capped at the service fee paid for the specific booking in dispute. Truck Wala is not liable for indirect, incidental or consequential damages." },
  { t: "11. Insurance", b: "Goods insurance is the responsibility of the shipper unless expressly bundled at checkout. Operators are required to maintain valid vehicle insurance at all times." },
  { t: "12. Termination", b: "You may close your account at any time. Truck Wala may suspend accounts for breach of these Terms, fraudulent activity, or abusive conduct toward staff or other users." },
  { t: "13. Grievances", b: "Any disputes must first be raised via the in-app support channel or by calling +91 70025 97575 within 15 days of the trip. Unresolved matters are subject to arbitration in Guwahati, Assam." },
  { t: "14. Changes to Terms", b: "Truck Wala may update these Terms from time to time. Continued use of the app after an update constitutes acceptance of the new Terms." },
];

export default function Terms() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={s.hdr}>
          <Pressable onPress={() => router.back()} testID="terms-back" style={s.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={type.h3}>Terms & Conditions</Text>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[type.small, { marginBottom: spacing.md }]}>Last updated: February 2026</Text>
        {SECTIONS.map((sec) => (
          <Card key={sec.t} style={s.section}>
            <Text style={s.title}>{sec.t}</Text>
            <Text style={s.body}>{sec.b}</Text>
          </Card>
        ))}
        <Text style={[type.small, { textAlign: "center", marginTop: spacing.lg }]}>
          Questions? Call our helpline +91 70025 97575
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  section: { padding: spacing.lg, marginBottom: spacing.md },
  title: { ...type.body, fontWeight: "800", marginBottom: 6 },
  body: { ...type.bodyMuted, lineHeight: 20 },
});
