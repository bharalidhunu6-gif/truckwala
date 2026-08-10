import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Alert, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button, Card, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius } from "@/src/theme";
import { api } from "@/src/api";

const REASONS = [
  "Driver behaviour",
  "Delayed pickup",
  "Damaged goods",
  "Overcharging / Extra fees",
  "Fake bidding",
  "Vehicle mismatch",
  "Other",
];

export default function NewComplaint() {
  const insets = useSafeAreaInsets();
  const { booking_id } = useLocalSearchParams<{ booking_id: string }>();
  const router = useRouter();
  const [subject, setSubject] = useState("Driver behaviour");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!message.trim()) return Alert.alert("Add details", "Please describe what went wrong.");
    if (!booking_id) return Alert.alert("Error", "Missing booking reference");
    setBusy(true);
    try {
      await api.fileComplaint({ booking_id, subject, message: message.trim() });
      Alert.alert("Complaint filed", "Our admin team will review this. Thank you.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not file complaint");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.header}>
          <Pressable testID="complaint-back" onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={type.small}>Report an issue</Text>
            <Text style={type.h2}>File complaint</Text>
          </View>
        </View>
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
          <Animated.View entering={FadeInDown.duration(300)}>
            <Card style={{ padding: spacing.lg, gap: spacing.md }}>
              <Text style={[type.h3, { marginBottom: 4 }]}>What&apos;s the issue?</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {REASONS.map((r) => (
                  <Pressable key={r} testID={`reason-${r}`} onPress={() => setSubject(r)} style={[styles.chip, subject === r && styles.chipActive]}>
                    <Text style={[styles.chipText, subject === r && styles.chipTextActive]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Details">
                <TextInput
                  testID="complaint-message"
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe what happened in detail…"
                  placeholderTextColor={colors.onSurfaceDim}
                  multiline
                  numberOfLines={6}
                  style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
                />
              </Field>
              <Button testID="submit-complaint" label="Submit complaint" onPress={submit} loading={busy} leftIcon="send-outline" fullWidth />
            </Card>
          </Animated.View>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brand} />
            <Text style={{ ...type.small, color: colors.onSurface, flex: 1 }}>
              False or malicious complaints may result in permanent account ban for the reporter. Please only file genuine issues.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, fontWeight: "600", color: colors.onSurfaceMuted },
  chipTextActive: { color: colors.onBrand },
  note: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandLight },
});
