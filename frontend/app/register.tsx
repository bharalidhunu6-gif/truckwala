import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { useAuth } from "@/src/auth";

export default function Register() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"customer" | "driver">("customer");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
  router.replace("/phone-login");
};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => router.back()} testID="reg-back" style={styles.iconBtn}>
              <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: spacing.xl }}>
            <Text style={type.display}>Create account</Text>
            <Text style={[type.bodyMuted, { marginTop: 4, marginBottom: spacing.xl }]}>Get started in seconds — no credit card required.</Text>

            <Text style={[type.label, { marginBottom: 10 }]}>I AM A</Text>
            <View style={styles.roleWrap}>
              {(["customer", "driver"] as const).map((r) => {
                const active = role === r;
                const label = r === "customer" ? "Shipper" : "Truck Owner";
                const desc = r === "customer" ? "I need to move goods" : "I have trucks to offer";
                const ic = r === "customer" ? "cube-outline" : "car-outline";
                return (
                  <Pressable
                    key={r}
                    testID={`role-${r}`}
                    onPress={() => setRole(r)}
                    style={[styles.roleCard, active && styles.roleCardActive]}
                  >
                    <View style={[styles.roleIcon, active && { backgroundColor: colors.brand }]}>
                      <Ionicons name={ic as any} size={22} color={active ? colors.onBrand : colors.onSurfaceMuted} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ ...type.body, fontWeight: "700", color: active ? colors.brand : colors.onSurface }}>{label}</Text>
                      <Text style={type.small}>{desc}</Text>
                    </View>
                    <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.brand : colors.borderStrong} />
                  </Pressable>
                );
              })}
            </View>

            <View style={{ height: spacing.lg }} />

            <Field label="Full Name">
              <TextInput testID="register-name-input" value={name} onChangeText={setName} placeholder="Rajesh Kumar" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
            </Field>
            <Field label="Email">
              <TextInput testID="register-email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
            </Field>
            <Field label="Phone">
              <TextInput testID="register-phone-input" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 9876543210" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
            </Field>
            <Field label="Password" hint="Min 6 characters">
              <TextInput testID="register-password-input" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
            </Field>
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button testID="register-submit-button" label="Create account" onPress={submit} loading={loading} fullWidth />
            <Pressable testID="go-login-link" onPress={() => router.replace("/login")} style={{ marginTop: spacing.lg, alignItems: "center" }}>
              <Text style={{ ...type.body, color: colors.brand, fontWeight: "600" }}>Already have an account? Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  roleWrap: { gap: 10 },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.sm,
  },
  roleCardActive: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  roleIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  err: { ...type.small, color: colors.error, marginBottom: spacing.md, textAlign: "center" },
});
