import { Platform } from "react-native";

// Uber Freight-inspired palette
export const colors = {
  // Surfaces
  surface: "#FFFFFF",
  surfaceAlt: "#F7F8FA",
  surfaceMuted: "#F0F2F5",
  surfaceInverse: "#0B0F14",
  card: "#FFFFFF",

  // Text
  onSurface: "#0B0F14",
  onSurfaceMuted: "#5B6675",
  onSurfaceDim: "#8A94A6",
  onSurfaceInverse: "#FFFFFF",

  // Brand — deep blue (Uber Freight-ish)
  brand: "#0A5AF0",
  brandDark: "#0745C7",
  brandLight: "#E8F0FF",
  onBrand: "#FFFFFF",

  // Accent
  accent: "#0B0F14", // black CTA option

  // Semantic
  success: "#0AA65B",
  successLight: "#E7F8EF",
  warning: "#F59E0B",
  warningLight: "#FEF3C7",
  error: "#E53935",
  errorLight: "#FFEBEE",
  info: "#2563EB",

  // Borders
  border: "#E4E7EC",
  borderStrong: "#D0D5DD",
  divider: "#EEF0F3",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };

export const fonts = {
  sans: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "System",
  }) as string,
  sansMedium: Platform.select({
    ios: "System",
    android: "sans-serif-medium",
    default: "System",
  }) as string,
};

export const type = {
  display: { fontFamily: fonts.sans, fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.8, color: colors.onSurface },
  h1: { fontFamily: fonts.sans, fontSize: 24, fontWeight: "800" as const, letterSpacing: -0.4, color: colors.onSurface },
  h2: { fontFamily: fonts.sans, fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2, color: colors.onSurface },
  h3: { fontFamily: fonts.sans, fontSize: 17, fontWeight: "700" as const, color: colors.onSurface },
  body: { fontFamily: fonts.sans, fontSize: 15, fontWeight: "500" as const, color: colors.onSurface },
  bodyMuted: { fontFamily: fonts.sans, fontSize: 14, fontWeight: "500" as const, color: colors.onSurfaceMuted },
  small: { fontFamily: fonts.sans, fontSize: 12, fontWeight: "500" as const, color: colors.onSurfaceMuted },
  label: { fontFamily: fonts.sansMedium, fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.4, color: colors.onSurfaceMuted },
  overline: { fontFamily: fonts.sansMedium, fontSize: 11, fontWeight: "700" as const, letterSpacing: 1.2, color: colors.onSurfaceDim },
  metric: { fontFamily: fonts.sans, fontSize: 22, fontWeight: "800" as const, letterSpacing: -0.4, color: colors.onSurface },
};

export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };

export const shadow = {
  sm: {
    shadowColor: "#0B0F14",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "#0B0F14",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: "#0B0F14",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 6,
  },
};
