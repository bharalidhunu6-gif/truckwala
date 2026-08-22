import { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { colors, type } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role === "admin") router.replace("/admin/trucks");
    else router.replace("/(app)/home");
  }, [loading, user]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ ...type.metric, color: colors.brand, letterSpacing: 2 }}>TRUCK WALA</Text>
      <Text style={{ ...type.label, color: colors.onSurfaceInverse, marginTop: 12, letterSpacing: 3 }}>
        LOGISTICS.NETWORK
      </Text>
      <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
    </View>
  );
}
