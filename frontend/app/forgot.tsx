import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { api } from "@/src/api";

export default function Forgot() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [phone, setPhone] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const sendOtp = async () => {
    setErr("");
    if (!phone) return setErr("Enter your registered phone number");
    setLoading(true);
    try {
      const res = await api.otpSend(phone.trim(), "reset");
      setDevOtp(res.dev_otp || "");
      setStep("otp");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const reset = async () => {
    setErr("");
    if (!code || code.length < 6) return setErr("Enter the 6-digit code");
    if (!pw || pw.length < 6) return setErr("New password must be at least 6 characters");
    if (pw !== pw2) return setErr("Passwords do not match");
    setLoading(true);
    try {
      const result = await api.resetPassword(phone.trim(), code, pw);

console.log("Reset Response:", result);

Alert.alert(
  "Success",
  "Password has been reset successfully.",
  [
    {
      text: "OK",
      onPress: () => router.replace("/login"),
    },
  ]
);
    } catch (e: any) {
  console.log("Reset Error:", e);
  Alert.alert("Error", e.message || "Password reset failed");
  setErr(e.message || "Password reset failed");
} finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ padding: spacing.lg }}>
            <Pressable onPress={() => router.back()} testID="forgot-back" style={styles.iconBtn}>
              <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: spacing.xl }}>
            <Text style={type.display}>Reset password</Text>
            <Text style={[type.bodyMuted, { marginTop: 4, marginBottom: spacing.xl }]}>
              {step === "email"
                ? "We'll send a 4-digit code to your phone."
                : "Enter the code and pick a new password."}
            </Text>

            {step === "email" ? (
              <>
                <Field label="phone number">
                  <TextInput testID="forgot-phone" value={phone} onChangeText={setPhone} autoCapitalize="none" keyboardType="phone-pad" placeholder="123-456-7890" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-send-otp" label="Send code" onPress={sendOtp} loading={loading} leftIcon="mail-outline" fullWidth />
              </>
            ) : (
              <>
                {devOtp ? (
                  <View style={styles.devPill}>
                    <Ionicons name="information-circle" size={14} color={colors.info} />
                    <Text style={styles.devText}>MVP mode — your code is <Text style={{ fontWeight: "800" }}>{devOtp}</Text></Text>
                  </View>
                ) : null}
                <Field label="6-digit Code">
                  <TextInput testID="forgot-code" value={code} onChangeText={setCode} keyboardType="numeric" maxLength={6} placeholder="000000" placeholderTextColor={colors.onSurfaceDim} style={[inputStyle, { letterSpacing: 8, textAlign: "center", fontSize: 22, fontWeight: "700" }]} />
                </Field>
                <Field label="New password" hint="Min 6 characters">
                  <TextInput testID="forgot-pw" value={pw} onChangeText={setPw} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
                <Field label="Confirm password">
                  <TextInput testID="forgot-pw2" value={pw2} onChangeText={setPw2} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-reset" label="Reset password" onPress={reset} loading={loading} leftIcon="lock-closed-outline" fullWidth />
                <Pressable onPress={() => setStep("email")} style={{ marginTop: spacing.md, alignItems: "center" }}>
                  <Text style={{ ...type.body, color: colors.brand, fontWeight: "600" }}>Change phone number</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  err: { ...type.small, color: colors.error, textAlign: "center", padding: spacing.md, backgroundColor: colors.errorLight, borderRadius: radius.md, marginBottom: spacing.md },
  devPill: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.md, backgroundColor: colors.brandLight, borderRadius: radius.md, marginBottom: spacing.lg, ...shadow.sm },
  devText: { ...type.small, color: colors.brand, flex: 1 },
});
