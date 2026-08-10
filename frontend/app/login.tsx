import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Button, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius } from "@/src/theme";
import { useAuth } from "@/src/auth";

const HERO = "https://images.unsplash.com/photo-1755728531140-88e0b2a72d75";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!email || !password) return setErr("Please enter your email and password");
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      if (u.role === "admin") router.replace("/admin/trucks");
      else router.replace("/(app)/home");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 40,}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={["rgba(11,15,20,0.35)", "rgba(11,15,20,0.95)"]} style={StyleSheet.absoluteFill} />
            <SafeAreaView edges={["top"]} style={{ flex: 1, padding: spacing.xl, justifyContent: "space-between" }}>
              <View style={styles.brandRow}>
                <View style={styles.brandIcon}>
                  <Ionicons name="cube" size={20} color={colors.onBrand} />
                </View>
                <Text style={styles.brandName}>Truck Wala</Text>
              </View>
              <View>
                <Text style={styles.heroTag}>Move anything, anywhere</Text>
                <Text style={styles.heroTitle}>Freight,{"\n"}delivered smarter.</Text>
              </View>
            </SafeAreaView>
          </View>

          <View style={styles.form}>
            <Text style={type.h1}>Welcome back</Text>
            <Text style={[type.bodyMuted, { marginBottom: spacing.xl, marginTop: 4 }]}>Sign in to continue moving loads.</Text>

            <Field label="Email">
              <TextInput
                testID="login-email-input"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@company.com"
                placeholderTextColor={colors.onSurfaceDim}
                style={inputStyle}
              />
            </Field>
            <Field label="Password">
              <TextInput
                testID="login-password-input"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="Enter password"
                placeholderTextColor={colors.onSurfaceDim}
                style={inputStyle}
              />
            </Field>
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button testID="login-submit-button" label="Sign In" onPress={submit} loading={loading} fullWidth />

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.line} />
            </View>

            <Pressable testID="phone-login-link" onPress={() => router.push("/phone-login")} style={[styles.altBtn, { marginBottom: spacing.md }]}>
              <Ionicons name="phone-portrait-outline" size={16} color={colors.brand} />
              <Text style={styles.altText}>Continue with mobile number</Text>
            </Pressable>

            <Pressable testID="forgot-password-link" onPress={() => router.push("/forgot")} style={{ marginTop: spacing.md, alignItems: "center" }}>
              <Text style={{ ...type.body, color: colors.brand, fontWeight: "600" }}>Forgot password?</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 340, backgroundColor: colors.surfaceInverse, overflow: "hidden" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  brandName: { ...type.h2, color: colors.onSurfaceInverse },
  heroTag: { ...type.label, color: colors.onSurfaceInverse, opacity: 0.85, marginBottom: 8, textTransform: "uppercase" as const },
  heroTitle: { ...type.display, color: colors.onSurfaceInverse, fontSize: 36, lineHeight: 40 },
  form: { padding: spacing.xl },
  err: { ...type.small, color: colors.error, marginBottom: spacing.md, textAlign: "center" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.xl },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...type.label, marginHorizontal: 12, color: colors.onSurfaceDim },
  altBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  altText: { ...type.body, color: colors.brand, fontWeight: "700" },
});
