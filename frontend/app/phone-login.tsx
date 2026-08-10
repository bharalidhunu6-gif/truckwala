import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Pressable, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";

const HERO = "https://images.unsplash.com/photo-1755728531140-88e0b2a72d75";
const RESEND_SECS = 30;

type Step = "phone" | "otp" | "profile";

export default function PhoneLogin() {
  const router = useRouter();
  const { loginWithPhone } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [normPhone, setNormPhone] = useState("");
  const [otp, setOtp] = useState("");
 const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [role, setRole] = useState<"customer" | "driver">("customer");
  const [isNewUser, setIsNewUser] = useState(false);
  const [delivery, setDelivery] = useState<string>("");
  const [devOtp, setDevOtp] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startResendTimer = () => {
    setResendIn(RESEND_SECS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) { clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const sendOtp = async () => {
    setErr("");
    const trimmed = phone.trim();
    if (!trimmed || trimmed.replace(/\D/g, "").length < 8) {
      return setErr("Please enter a valid mobile number");
    }
    setBusy(true);
    try {
      const res = await api.phoneSendOtp(trimmed, "login");
      setNormPhone(res.phone);
      setIsNewUser(!!res.is_new_user);
      setDelivery(res.delivery || "");
      setDevOtp(res.dev_otp);
      setStep("otp");
      startResendTimer();
    } catch (e: any) {
      setErr(e.message || "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    if (resendIn > 0) return;
    setOtp("");
    setBusy(true);
    setErr("");
    try {
      const res = await api.phoneSendOtp(normPhone || phone, "login");
      setNormPhone(res.phone);
      setDelivery(res.delivery || "");
      setDevOtp(res.dev_otp);
      startResendTimer();
    } catch (e: any) {
      setErr(e.message || "Failed to resend");
    } finally {
      setBusy(false);
    }
  };

 const verifyOtp = async () => {
  setErr("");

  if (!otp || otp.length <4) {
    setErr("Enter the OTP");
    return;
  }

  setBusy(true);

  try {
    const u = await loginWithPhone({
      phone: normPhone,
      code: otp,
    });

    // OTP verified successfully.
    // Only backend can decide whether this is an existing user
    // or a new user requiring profile completion.

    if ((u as any)?.requires_profile === true) {
      setStep("profile");
      return;
    }

    if (u?.role === "admin") {
      router.replace("/admin/trucks");
    } else {
      router.replace("/(app)/home");
    }

  } catch (e: any) {
  console.log("OTP VERIFY ERROR:", e);

  // New phone user: OTP is valid, profile is required
  if (e?.code === "PROFILE_REQUIRED" || e?.detail?.requires_profile === true) {
    setErr("");
    setStep("profile");
    return;
  }

  setErr(e?.message || "Invalid or expired OTP");
} finally {
    setBusy(false);
  }
};

  const submitProfile = async () => {
    setErr("");
    if (!name.trim()) return setErr("Please enter your name");
    setBusy(true);
    try {
      const u = await loginWithPhone({ phone: normPhone, code: otp, name: name.trim(), role, email: email.trim(),});
      if (u.role === "admin") router.replace("/admin/trucks");
      else router.replace("/(app)/home");
    } catch (e: any) {
      setErr(e.message || "Could not complete signup");
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setErr("");
    if (step === "otp") setStep("phone");
    else if (step === "profile") setStep("otp");
    else router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Hero header */}
          <View style={styles.hero}>
            <Image source={HERO} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient colors={["rgba(11,15,20,0.35)", "rgba(11,15,20,0.95)"]} style={StyleSheet.absoluteFill} />
            <SafeAreaView edges={["top"]} style={{ flex: 1, padding: spacing.xl, justifyContent: "space-between" }}>
              <Pressable onPress={back} testID="phone-back" style={styles.backCircle}>
                <Ionicons name="arrow-back" size={20} color={colors.onSurfaceInverse} />
              </Pressable>
              <View>
                <Text style={styles.heroTag}>Sign in with mobile</Text>
                <Text style={styles.heroTitle}>{step === "phone" ? "Your number,\nyour trip." : step === "otp" ? "Enter the code" : "One quick step"}</Text>
              </View>
            </SafeAreaView>
          </View>

          {/* Body */}
          <View style={styles.form}>
            {step === "phone" && (
              <Animated.View entering={FadeInDown.duration(400)}>
                <Text style={type.h2}>Enter mobile number</Text>
                <Text style={[type.bodyMuted, { marginTop: 4, marginBottom: spacing.xl }]}>We&apos;ll send you a 6-digit OTP.</Text>

                <Field label="Mobile number">
                  <View style={styles.phoneRow}>
                    <View style={styles.ccBox}>
                      <Text style={{ ...type.body, fontWeight: "700" }}>🇮🇳</Text>
                      <Text style={{ ...type.body, fontWeight: "700", marginLeft: 4 }}>+91</Text>
                    </View>
                    <TextInput
                      testID="phone-input"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      placeholder="9876543210"
                      placeholderTextColor={colors.onSurfaceDim}
                      maxLength={15}
                      style={[inputStyle, { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }]}
                    />
                  </View>
                </Field>
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="phone-send-otp" label="Send OTP" onPress={sendOtp} loading={busy} leftIcon="paper-plane-outline" fullWidth />

                <View style={styles.divider}>
                  <View style={styles.line} />
                  <Text style={styles.orText}>OR</Text>
                  <View style={styles.line} />
                </View>
                <Pressable testID="use-email-login" onPress={() => router.replace("/login")} style={styles.altBtn}>
                  <Ionicons name="mail-outline" size={16} color={colors.brand} />
                  <Text style={styles.altText}>Continue with email</Text>
                </Pressable>
              </Animated.View>
            )}

            {step === "otp" && (
              <Animated.View entering={FadeInDown.duration(400)}>
                <Text style={type.h2}>Verify your number</Text>
                <Text style={[type.bodyMuted, { marginTop: 4, marginBottom: spacing.md }]}>
                  Enter the code we sent to <Text style={{ fontWeight: "700", color: colors.onSurface }}>{normPhone}</Text>
                </Text>

                {delivery === "dev" && devOtp ? (
                  <View style={styles.devHint}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.brand} />
                    <Text style={styles.devHintText}>
                      Dev mode — your code is <Text style={{ fontWeight: "700" }}>{devOtp}</Text>
                    </Text>
                  </View>
                ) : delivery === "twilio_sms" || delivery === "twilio_verify" ? (
                  <View style={[styles.devHint, { backgroundColor: colors.successLight }]}>
                    <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                    <Text style={[styles.devHintText, { color: colors.success }]}>SMS sent via Twilio</Text>
                  </View>
                ) : null}

                <Field label="6-digit code">
                  <TextInput
                    testID="phone-otp-input"
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="numeric"
                    maxLength={6}
                    placeholder="000000"
                    placeholderTextColor={colors.onSurfaceDim}
                    style={[inputStyle, { letterSpacing: 8, textAlign: "center", fontSize: 24, fontWeight: "700" }]}
                  />
                </Field>
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button
  testID="phone-verify-otp"
  label="Verify OTP"
  onPress={verifyOtp}
  loading={busy}
  leftIcon="checkmark-outline"
  fullWidth
/>

                <Pressable testID="phone-resend-otp" onPress={resendOtp} disabled={resendIn > 0} style={{ marginTop: spacing.lg, alignItems: "center" }}>
                  <Text style={{ ...type.body, color: resendIn > 0 ? colors.onSurfaceDim : colors.brand, fontWeight: "600" }}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                  </Text>
                </Pressable>
              </Animated.View>
            )}

            {step === "profile" && (
  <Animated.View entering={FadeInDown.duration(400)}>
    <Text style={type.h2}>Create your account</Text>

    <Text
      style={[
        type.bodyMuted,
        { marginTop: 4, marginBottom: spacing.xl },
      ]}
    >
      Your mobile number is verified. Complete your details to create your account.
    </Text>

    <Text style={[type.label, { marginBottom: 10 }]}>I AM A</Text>

    <View style={{ gap: 10, marginBottom: spacing.lg }}>
      {(["customer", "driver"] as const).map((r) => {
        const active = role === r;

        const label =
          r === "customer" ? "Shipper" : "Truck Owner";

        const desc =
          r === "customer"
            ? "I need to move goods"
            : "I have trucks to offer";

        const ic =
          r === "customer"
            ? "cube-outline"
            : "car-outline";

        return (
          <Pressable
            key={r}
            testID={`phone-role-${r}`}
            onPress={() => setRole(r)}
            style={[
              styles.roleCard,
              active && styles.roleCardActive,
            ]}
          >
            <View
              style={[
                styles.roleIcon,
                active && { backgroundColor: colors.brand },
              ]}
            >
              <Ionicons
                name={ic as any}
                size={22}
                color={
                  active
                    ? colors.onBrand
                    : colors.onSurfaceMuted
                }
              />
            </View>

            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text
                style={{
                  ...type.body,
                  fontWeight: "700",
                  color: active
                    ? colors.brand
                    : colors.onSurface,
                }}
              >
                {label}
              </Text>

              <Text style={type.small}>{desc}</Text>
            </View>

            <Ionicons
              name={
                active
                  ? "radio-button-on"
                  : "radio-button-off"
              }
              size={20}
              color={
                active
                  ? colors.brand
                  : colors.borderStrong
              }
            />
          </Pressable>
        );
      })}
    </View>

    {/* FULL NAME */}
    <Field label="Full name">
      <TextInput
        testID="phone-name-input"
        value={name}
        onChangeText={setName}
        placeholder="Rajesh Kumar"
        placeholderTextColor={colors.onSurfaceDim}
        style={inputStyle}
      />
    </Field>

    {/* EMAIL */}
    <Field label="Email ID">
      <TextInput
        testID="phone-email-input"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={colors.onSurfaceDim}
        style={inputStyle}
      />
    </Field>

    {/* VERIFIED PHONE */}
    <Field label="Phone number">
      <TextInput
        testID="phone-verified-input"
        value={normPhone}
        editable={false}
        style={[
          inputStyle,
          {
            backgroundColor: colors.surfaceAlt,
            color: colors.onSurfaceMuted,
          },
        ]}
      />
    </Field>

    {/* PASSWORD */}
    <Field label="Password" hint="Min 6 characters">
      <TextInput
        testID="phone-password-input"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.onSurfaceDim}
        style={inputStyle}
      />
    </Field>

    {err ? (
      <Text style={styles.err}>{err}</Text>
    ) : null}

    <Button
      testID="phone-complete-signup"
      label="Create account"
      onPress={submitProfile}
      loading={busy}
      leftIcon="checkmark-done"
      fullWidth
    />
  </Animated.View>
)}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 260, backgroundColor: colors.surfaceInverse, overflow: "hidden" },
  backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  heroTag: { ...type.label, color: colors.onSurfaceInverse, opacity: 0.85, marginBottom: 8, textTransform: "uppercase" as const },
  heroTitle: { ...type.display, color: colors.onSurfaceInverse, fontSize: 30, lineHeight: 34 },
  form: { padding: spacing.xl, flex: 1 },
  phoneRow: { flexDirection: "row", alignItems: "stretch" },
  ccBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 14, borderWidth: 1, borderRightWidth: 0, borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md,
    minWidth: 92,
  },
  err: { ...type.small, color: colors.error, marginBottom: spacing.md, textAlign: "center" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.xl },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...type.label, marginHorizontal: 12, color: colors.onSurfaceDim },
  altBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  altText: { ...type.body, color: colors.brand, fontWeight: "700" },
  devHint: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.brandLight, marginBottom: spacing.md,
  },
  devHintText: { ...type.small, color: colors.brand, flex: 1 },
  roleCard: {
    flexDirection: "row", alignItems: "center", padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    borderRadius: radius.lg, ...shadow.sm,
  },
  roleCardActive: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  roleIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
});
