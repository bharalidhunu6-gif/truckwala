import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { colors } from "@/src/theme";

export default function AppTabs() {
  const { user, loading } = useAuth();
  const insets = useSafeAreaInsets();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;

  const isDriver = user.role === "driver";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceDim,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8),
          ...Platform.select({
            ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.04, shadowRadius: 8 },
            android: { elevation: 8 },
          }),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: isDriver ? "Loads" : "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? (isDriver ? "list" : "home") : (isDriver ? "list-outline" : "home-outline")} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: isDriver ? "Trucks" : "Ship",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                isDriver
                  ? (focused ? "car-sport" : "car-sport-outline")
                  : (focused ? "add-circle" : "add-circle-outline")
              }
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: isDriver ? "Trips" : "Bookings",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "cube" : "cube-outline"} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={26} color={color} />,
        }}
      />
    </Tabs>
  );
}
