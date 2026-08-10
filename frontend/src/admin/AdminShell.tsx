/**
 * Shared admin shell — renders a sidebar navigation on wide screens
 * (web/tablet ≥900 px) and a compact top-bar on phones. Keeps the
 * inner page content inside a max-width container so the tables/cards
 * don't stretch across a 27" monitor.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, useWindowDimensions, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { colors, spacing, type, radius } from "@/src/theme";

const NAV = [
  { path: "/admin", label: "Dashboard", icon: "grid-outline" },
  { path: "/admin/trucks", label: "Vehicles", icon: "car-outline" },
  { path: "/admin/subscriptions", label: "Subscriptions", icon: "card-outline" },
  { path: "/admin/complaints", label: "Complaints", icon: "alert-circle-outline" },
] as const;

export const ADMIN_CONTENT_MAX_WIDTH = 1180;

export function AdminShell({
  children,
  title,
  subtitle,
  right,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const path = usePathname() || "";
  const { user, logout } = useAuth();
  const isWide = width >= 900 || Platform.OS === "web";

  const NavBody = ({ orientation }: { orientation: "row" | "col" }) => (
    <View style={orientation === "col" ? styles.navCol : styles.navRow}>
      {NAV.map((item) => {
        const active = path === item.path || (item.path !== "/admin" && path.startsWith(item.path));
        return (
          <Pressable
            key={item.path}
            testID={`admin-nav-${item.label.toLowerCase()}`}
            onPress={() => router.push(item.path as any)}
            style={[orientation === "col" ? styles.navItem : styles.navPill, active && (orientation === "col" ? styles.navItemActive : styles.navPillActive)]}
          >
            <Ionicons name={item.icon as any} size={18} color={active ? colors.onBrand : colors.onSurfaceMuted} />
            <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
        <View style={{ flex: 1, flexDirection: isWide ? "row" : "column" }}>
          {/* Sidebar (wide) */}
          {isWide && (
            <View style={styles.sidebar}>
              <View style={styles.brandRow}>
                <View style={styles.brandBadge}><Ionicons name="cube" size={18} color={colors.onBrand} /></View>
                <View>
                  <Text style={{ ...type.h3 }}>Truck Wala</Text>
                  <Text style={type.small}>Admin Console</Text>
                </View>
              </View>
              <NavBody orientation="col" />
              <View style={{ flex: 1 }} />
              <View style={styles.sidebarFooter}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.small, fontWeight: "700", color: colors.onSurface }}>{user?.name || "Admin"}</Text>
                  <Text style={type.small} numberOfLines={1}>{user?.email}</Text>
                </View>
                <Pressable testID="admin-logout" onPress={async () => { await logout(); router.replace("/login"); }} style={styles.iconBtn}>
                  <Ionicons name="log-out-outline" size={18} color={colors.onSurfaceMuted} />
                </Pressable>
              </View>
            </View>
          )}

          {/* Main content */}
          <View style={{ flex: 1 }}>
            {/* Mobile top-bar */}
            {!isWide && (
              <View style={styles.mobileTop}>
                <View style={styles.brandBadge}><Ionicons name="cube" size={16} color={colors.onBrand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={type.small}>Truck Wala Admin</Text>
                  <Text style={type.h3}>{title}</Text>
                </View>
                <Pressable testID="admin-logout" onPress={async () => { await logout(); router.replace("/login"); }} style={styles.iconBtn}>
                  <Ionicons name="log-out-outline" size={18} color={colors.onSurfaceMuted} />
                </Pressable>
              </View>
            )}
            {!isWide && <NavBody orientation="row" />}

            {/* Page header (wide only) */}
            {isWide && (
              <View style={styles.pageHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={type.small}>{subtitle || "Admin Console"}</Text>
                  <Text style={{ ...type.display, fontSize: 26 }}>{title}</Text>
                </View>
                {right}
              </View>
            )}

            {/* Centered content column */}
            <View style={{ flex: 1, alignItems: "stretch" }}>
              <View style={{ flex: 1, maxWidth: ADMIN_CONTENT_MAX_WIDTH, width: "100%", alignSelf: "center" }}>
                {children}
              </View>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 240,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: spacing.md, borderBottomWidth: 1, borderColor: colors.divider },
  brandBadge: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  navCol: { gap: 4 },
  navRow: { flexDirection: "row", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, flexWrap: "wrap" },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md },
  navItemActive: { backgroundColor: colors.brand },
  navPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  navPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  navText: { ...type.small, fontWeight: "700", color: colors.onSurfaceMuted },
  navTextActive: { color: colors.onBrand },
  sidebarFooter: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: spacing.md, borderTopWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  mobileTop: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
  pageHeader: { flexDirection: "row", alignItems: "flex-end", padding: spacing.xl, gap: 12, borderBottomWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
});
