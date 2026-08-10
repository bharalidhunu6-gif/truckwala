import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { Button } from "@/src/ui";

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = user?.role === "admin";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.hero}>
          <View style={styles.avatarBig}>
            <Text style={{ ...type.display, color: colors.onBrand, fontSize: 32 }}>{user?.name?.[0]?.toUpperCase() || "U"}</Text>
          </View>
          <Text testID="profile-name" style={[type.h1, { marginTop: spacing.md }]}>{user?.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Text style={type.small}>
              {isAdmin ? "Administrator" : user?.role === "driver" ? "Truck Operator" : "Shipper"}
            </Text>
            <Text style={type.small}>·</Text>
            <Ionicons name="star" size={12} color={colors.warning} />
            <Text style={{ ...type.small, color: colors.onSurface, fontWeight: "700" }}>
              {(user?.avg_rating || 0).toFixed(1)}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
        {isAdmin && (
          <View style={styles.section}>
            <Text style={[type.label, styles.sectionLabel]}>ADMIN</Text>
            <Row icon="shield-checkmark-outline" label="Truck Verifications" onPress={() => router.push("/admin/trucks")} />
          </View>
        )}

        <View style={styles.section}>
          <Text style={[type.label, styles.sectionLabel]}>ACCOUNT</Text>
          <Row icon="mail-outline" label="Email" value={user?.email} />
          <Row icon="call-outline" label="Phone" value={user?.phone} />
          <Row icon="shield-checkmark-outline" label="Verified" value={user?.verified ? "Yes" : "Pending"} />
        </View>

        <View style={styles.section}>
          <Text style={[type.label, styles.sectionLabel]}>SUPPORT</Text>
          <Row icon="call-outline" label="Customer Care · +91 70025 97575" onPress={() => router.push("/support")} />
          <Row icon="help-circle-outline" label="Help Center" onPress={() => router.push("/support")} />
          <Row icon="document-text-outline" label="Terms & Conditions" onPress={() => router.push("/terms")} />
          <Row icon="lock-closed-outline" label="Privacy Policy" onPress={() => router.push("/terms")} />
        </View>

        <View style={{ padding: spacing.lg }}>
          <Button
            testID="logout-btn"
            label="Sign Out"
            variant="secondary"
            leftIcon="log-out-outline"
            onPress={async () => { await logout(); router.replace("/login"); }}
            fullWidth
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value, chevron, onPress }: { icon: any; label: string; value?: any; chevron?: boolean; onPress?: () => void }) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.body, fontWeight: "600" }}>{label}</Text>
        {value ? <Text style={type.small}>{String(value)}</Text> : null}
      </View>
      {(chevron || onPress) && <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceDim} />}
    </View>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>{content}</Pressable>;
  }
  return content;
}

const styles = StyleSheet.create({
  hero: { padding: spacing.xl, alignItems: "center", borderBottomWidth: 1, borderColor: colors.divider },
  avatarBig: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center", ...shadow.md,
  },
  section: {
    marginTop: spacing.md, marginHorizontal: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, ...shadow.sm,
    overflow: "hidden",
  },
  sectionLabel: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: 12, borderTopWidth: 1, borderColor: colors.divider },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
});
