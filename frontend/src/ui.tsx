import React from "react";
import { View, Text, Pressable, StyleSheet, ViewStyle, TextStyle, ActivityIndicator, Animated } from "react-native";
import { colors, type, spacing, radius, shadow } from "./theme";
import { Ionicons } from "@expo/vector-icons";

type BtnProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark";
  size?: "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
  fullWidth?: boolean;
  leftIcon?: any;
};

export function Button({ label, onPress, variant = "primary", size = "lg", loading, disabled, style, testID, fullWidth, leftIcon }: BtnProps) {
  const h = size === "lg" ? 54 : 44;
  const base: ViewStyle = {
    height: h,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderRadius: radius.md,
    gap: 8,
  };
  const styles: Record<string, ViewStyle> = {
    primary: { backgroundColor: colors.brand },
    dark: { backgroundColor: colors.accent },
    secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
    ghost: { backgroundColor: "transparent" },
    danger: { backgroundColor: colors.error },
  };
  const labelColor =
    variant === "primary" || variant === "dark" || variant === "danger"
      ? colors.onBrand
      : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        styles[variant],
        variant === "primary" && shadow.sm,
        fullWidth && { alignSelf: "stretch" },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.86, transform: [{ scale: 0.99 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {leftIcon ? <Ionicons name={leftIcon} size={18} color={labelColor} /> : null}
          <Text style={{ ...type.body, color: labelColor, fontSize: 15, fontWeight: "700" }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  testID,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  testID?: string;
}) {
  return (
    <View style={fs.wrap} testID={testID}>
      <Text style={fs.label}>{label}</Text>
      {children}
      {error ? <Text style={fs.err}>{error}</Text> : hint ? <Text style={fs.hint}>{hint}</Text> : null}
    </View>
  );
}

export const inputStyle: TextStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: spacing.md,
  paddingVertical: 14,
  fontFamily: type.body.fontFamily,
  fontSize: 15,
  color: colors.onSurface,
  backgroundColor: colors.surface,
  borderRadius: radius.md,
};

const fs = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { ...type.label, marginBottom: 8, color: colors.onSurfaceMuted },
  hint: { ...type.small, color: colors.onSurfaceDim, marginTop: 6 },
  err: { ...type.small, color: colors.error, marginTop: 6 },
});

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginLeft: inset }} />;
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: any;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 36,
          paddingHorizontal: 14,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: active ? colors.brand : colors.borderStrong,
          backgroundColor: active ? colors.brandLight : colors.surface,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 6,
          flexShrink: 0,
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? colors.brand : colors.onSurfaceMuted} /> : null}
      <Text style={{ ...type.small, color: active ? colors.brand : colors.onSurface, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Tag({ label, tone = "default", icon }: { label: string; tone?: "default" | "brand" | "success" | "warning" | "error"; icon?: any }) {
  const map: Record<string, { bg: string; fg: string }> = {
    default: { bg: colors.surfaceMuted, fg: colors.onSurfaceMuted },
    brand: { bg: colors.brandLight, fg: colors.brand },
    success: { bg: colors.successLight, fg: colors.success },
    warning: { bg: colors.warningLight, fg: "#92400E" },
    error: { bg: colors.errorLight, fg: colors.error },
  };
  const c = map[tone];
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: 4 }}>
      {icon ? <Ionicons name={icon} size={11} color={c.fg} /> : null}
      <Text style={{ ...type.small, color: c.fg, fontWeight: "700", fontSize: 11 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.xl,
        paddingBottom: spacing.sm,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text style={type.h3}>{title}</Text>
      {right}
    </View>
  );
}

export function Card({ children, style, onPress, testID }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void; testID?: string }) {
  const inner = (
    <View style={[cs.card, style]}>
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85, transform: [{ scale: 0.995 }] }]}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.sm,
  },
});

export function EmptyState({
  title,
  subtitle,
  icon = "cube-outline",
  action,
  testID,
}: {
  title: string;
  subtitle?: string;
  icon?: any;
  action?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID} style={{ padding: spacing.xxl, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg }}>
        <Ionicons name={icon} size={32} color={colors.onSurfaceDim} />
      </View>
      <Text style={{ ...type.h3, textAlign: "center", marginBottom: 6 }}>{title}</Text>
      {subtitle ? <Text style={{ ...type.bodyMuted, textAlign: "center" }}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

// Simple animated skeleton
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <Animated.View
      style={[
        { height, width, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, opacity },
        style as any,
      ]}
    />
  );
}

export function SkeletonCard() {
  return (
    <Card style={{ padding: spacing.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
        <Skeleton width={140} height={16} />
        <Skeleton width={60} height={20} />
      </View>
      <Skeleton width={"100%"} height={12} style={{ marginBottom: 8 }} />
      <Skeleton width={"70%"} height={12} />
    </Card>
  );
}
