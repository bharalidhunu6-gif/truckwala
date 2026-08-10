import { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  Pressable, RefreshControl, Alert, Image, Switch, Keyboard,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button, Field, inputStyle, EmptyState, Card, Tag } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { api } from "@/src/api";
import { BottomPicker, usePicker } from "@/src/pickers";
import { getDeviceId } from "@/src/deviceId";
import { checkFakeGps, alertOnFakeGps } from "@/src/gpsGuard";

export default function DriverTrucks() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [catalog, setCatalog] = useState<any>({ truck_types: [], body_types: [] });
  const [trucks, setTrucks] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [toggling, setToggling] = useState<string | null>(null);
  // Keyboard height — used to add extra bottom padding so the last truck in
  // the list stays visible when the "Add truck" form has an input focused.
  const [kbHeight, setKbHeight] = useState(0);

  const [reg, setReg] = useState("");
  const [truckType, setTruckType] = useState("Tata Ace");
  const [bodyType, setBodyType] = useState("Open");
  const [cap, setCap] = useState("");
  const [dims, setDims] = useState("");
  const [city, setCity] = useState("Bangalore");
  const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);
  const [rcPhoto, setRcPhoto] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const truckTypePicker = usePicker();
  const bodyTypePicker = usePicker();

  useEffect(() => { api.catalog().then(setCatalog).catch(() => {}); }, []);
  useEffect(() => { getDeviceId().then(setDeviceId); }, []);

  // Track keyboard so we can pad the ScrollView while the "Add truck" form is
  // editing — this prevents the last truck card / photo tiles from being
  // hidden under the keyboard on both iOS and Android.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  const load = useCallback(async () => {
    try { const t = await api.myTrucks(); setTrucks(t); } catch {} finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pick = async (setter: (s: string) => void) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed", "Please allow photo access to attach vehicle images.");
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: true,
    });
    if (!res.canceled && res.assets[0]?.base64) {
      setter(`data:${res.assets[0].mimeType || "image/jpeg"};base64,${res.assets[0].base64}`);
    }
  };

  const submit = async () => {
    setErr("");
    if (!reg || !cap) return setErr("Registration number and capacity are required");
    if (!vehiclePhoto) return setErr("Please attach a photo of the vehicle");
    if (!rcPhoto) return setErr("Please attach the RC (Registration Certificate) photo");
    setSaving(true);
    try {
      await api.createTruck({
        reg_number: reg.toUpperCase(),
        truck_type: truckType,
        body_type: bodyType,
        load_capacity_kg: parseFloat(cap),
        dimensions: dims,
        base_city: city,
        base_lat: 12.9716, base_lng: 77.5946,
        vehicle_photo: vehiclePhoto,
        rc_photo: rcPhoto,
      });
      setReg(""); setCap(""); setDims(""); setVehiclePhoto(null); setRcPhoto(null);
      setShowForm(false);
      load();
    } catch (e: any) {
      if (e?.code === "duplicate_reg_number" || e?.status === 409) {
        setErr(e.message || "This vehicle number is already registered.");
      } else {
        setErr(e.message || "Could not save truck");
      }
    } finally { setSaving(false); }
  };

  const toggleOnline = async (t: any, next: boolean) => {
    if (next) {
      // 1) subscription must be active
      if (!t.subscription_active) {
        Alert.alert(
          "Subscription required",
          `Your ${t.subscription_tier?.title || "plan"} subscription is inactive. Renew to accept bookings.`,
          [
            { text: "Later", style: "cancel" },
            { text: "Subscribe now", onPress: () => router.push(`/subscribe/${t.id}`) },
          ],
        );
        return;
      }
      // 2) block fake-GPS spoofers
      const g = await checkFakeGps();
      if (!g.ok) { alertOnFakeGps(g); return; }
    }
    setToggling(t.id);
    try {
      if (next) await api.setTruckOnline(t.id, deviceId);
      else await api.setTruckOffline(t.id);
      load();
    } catch (e: any) {
      if (e?.code === "subscription_required") {
        Alert.alert("Subscription required", e.message, [
          { text: "Later", style: "cancel" },
          { text: "Subscribe", onPress: () => router.push(`/subscribe/${t.id}`) },
        ]);
      } else if (e?.code === "in_use_elsewhere") {
        Alert.alert("Already active elsewhere", e.message);
      } else {
        Alert.alert("Error", e.message || "Could not update online status");
      }
    } finally { setToggling(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topbar}>
          <View style={{ flex: 1 }}>
            <Text style={type.small}>Fleet Manager</Text>
            <Text style={type.h2}>My Trucks</Text>
          </View>
          <Pressable testID="add-truck-cta" onPress={() => setShowForm(!showForm)} style={styles.addBtn}>
            <Ionicons name={showForm ? "close" : "add"} size={22} color={colors.onBrand} />
          </Pressable>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 80 + kbHeight }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {showForm && (
            <Animated.View entering={FadeInDown.duration(300)} style={styles.formCard}>
              <Text style={[type.h3, { marginBottom: spacing.md }]}>Add New Truck</Text>
              <Field label="Registration Number">
                <TextInput testID="truck-reg" value={reg} onChangeText={setReg} autoCapitalize="characters" placeholder="KA01AB1234" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
              </Field>
              <Field label="Truck Type">
                <SelectRow testID="pick-truck-type" value={truckType} placeholder="Choose type" onPress={truckTypePicker.open} />
              </Field>
              <Field label="Body Type">
                <SelectRow testID="pick-body-type" value={bodyType} placeholder="Choose body" onPress={bodyTypePicker.open} />
              </Field>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Field label="Capacity (kg / GVW)">
                    <TextInput testID="truck-cap" value={cap} onChangeText={setCap} keyboardType="numeric" placeholder="1000" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Base City">
                    <TextInput value={city} onChangeText={setCity} placeholder="Bangalore" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                  </Field>
                </View>
              </View>
              <Field label="Dimensions (optional)">
                <TextInput value={dims} onChangeText={setDims} placeholder="14ft x 6ft x 6ft" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
              </Field>

              {/* Photos: both required */}
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.sm }}>
                <PhotoTile testID="pick-vehicle-photo" label="Vehicle photo *" uri={vehiclePhoto} onPick={() => pick(setVehiclePhoto)} icon="car-outline" />
                <PhotoTile testID="pick-rc-photo" label="RC document *" uri={rcPhoto} onPick={() => pick(setRcPhoto)} icon="document-text-outline" />
              </View>

              {err ? <Text style={styles.err}>{err}</Text> : null}
              <Button testID="truck-save" label="Save Truck" onPress={submit} loading={saving} leftIcon="save-outline" fullWidth />
            </Animated.View>
          )}

          <View style={styles.sectionHead}>
            <Text style={type.h3}>Registered Fleet</Text>
            <Text style={type.small}>{trucks.length} vehicle{trucks.length !== 1 ? "s" : ""}</Text>
          </View>

          {trucks.length === 0 ? (
            <EmptyState
              testID="trucks-empty"
              icon="car-outline"
              title="No trucks yet"
              subtitle="Add your first truck to start receiving load requests."
              action={<Button label="Add truck" onPress={() => setShowForm(true)} leftIcon="add-outline" />}
            />
          ) : (
            trucks.map((t, idx) => (
              <Animated.View key={t.id} entering={FadeInDown.delay(idx * 60).duration(300)}>
                <Card style={styles.truckCard} testID={`truck-card-${t.id}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    {t.vehicle_photo ? (
                      <Image source={{ uri: t.vehicle_photo }} style={styles.truckThumb} />
                    ) : (
                      <View style={styles.truckIcon}><Ionicons name="car-sport" size={22} color={colors.brand} /></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={type.h3}>{t.reg_number}</Text>
                        {t.verified_badge && (
                          <View style={styles.verifiedPill}>
                            <Ionicons name="ribbon" size={11} color={colors.success} />
                            <Text style={{ ...type.small, color: colors.success, fontWeight: "700", fontSize: 10 }}>VERIFIED</Text>
                          </View>
                        )}
                      </View>
                      <Text style={type.small}>{t.truck_type} · {t.body_type} · {t.load_capacity_kg} kg</Text>
                      {t.completed_trips > 0 && (
                        <Text style={{ ...type.small, color: colors.onSurfaceMuted, marginTop: 2 }}>
                          {t.completed_trips} trip{t.completed_trips === 1 ? "" : "s"} completed
                          {t.completed_trips < 50 && t.verification_status === "approved" && (
                            <Text style={{ color: colors.brand, fontWeight: "600" }}>  ·  {50 - t.completed_trips} more for badge</Text>
                          )}
                        </Text>
                      )}
                    </View>
                    <Pressable onPress={async () => {
                      Alert.alert("Delete truck?", `${t.reg_number} will be removed from your fleet.`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: async () => { try { await api.deleteTruck(t.id); load(); } catch (e: any) { Alert.alert("Error", e.message); } } },
                      ]);
                    }} testID={`truck-delete-${t.id}`} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </Pressable>
                  </View>

                  {/* Status tags */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Tag
                      label={t.banned ? "banned" : (t.verification_status || "pending")}
                      tone={t.banned ? "error" : (t.verification_status === "approved" ? "success" : t.verification_status === "rejected" ? "error" : "warning")}
                      icon={t.banned ? "ban" : t.verification_status === "approved" ? "checkmark-circle" : t.verification_status === "rejected" ? "close-circle" : "time-outline"}
                    />
                    <Tag
                      label={t.subscription_active ? "SUB ACTIVE" : "SUB EXPIRED"}
                      tone={t.subscription_active ? "success" : "warning"}
                      icon={t.subscription_active ? "shield-checkmark" : "shield-outline"}
                    />
                    {t.online && <Tag label="ONLINE" tone="success" icon="radio" />}
                  </View>

                  {t.verification_status === "rejected" && t.rejection_reason ? (
                    <View style={styles.rejectBox}>
                      <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                      <Text style={{ ...type.small, color: colors.error, flex: 1 }}>{t.rejection_reason}</Text>
                    </View>
                  ) : null}
                  {t.banned && (
                    <View style={styles.rejectBox}>
                      <Ionicons name="ban" size={16} color={colors.error} />
                      <Text style={{ ...type.small, color: colors.error, flex: 1 }}>{t.ban_reason || "This vehicle has been banned by admin."}</Text>
                    </View>
                  )}

                  {/* Subscription row */}
                  <View style={styles.subRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={type.label}>PLAN</Text>
                      <Text style={{ ...type.body, fontWeight: "700" }}>
                        {t.subscription_tier?.title || (t.load_capacity_kg < 1500 ? "₹499/mo" : "₹999/mo")}
                      </Text>
                      {t.subscription_expires_at ? (
                        <Text style={type.small}>
                          {t.subscription_active ? "Renews " : "Expired "}
                          {new Date(t.subscription_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </Text>
                      ) : (
                        <Text style={type.small}>Not subscribed</Text>
                      )}
                    </View>
                    <Button
                      testID={`subscribe-${t.id}`}
                      label={t.subscription_active ? "Renew" : "Subscribe"}
                      variant={t.subscription_active ? "secondary" : "primary"}
                      leftIcon="card-outline"
                      onPress={() => router.push(`/subscribe/${t.id}`)}
                    />
                  </View>

                  {/* Online toggle */}
                  {t.verification_status === "approved" && !t.banned && (
                    <View style={styles.onlineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={type.label}>ACCEPTING LOADS</Text>
                        <Text style={type.small}>
                          {t.online
                            ? (t.online_device_id === deviceId ? "This device is broadcasting" : "Active on another device")
                            : "Toggle on to receive nearby loads"}
                        </Text>
                      </View>
                      <Switch
                        testID={`online-toggle-${t.id}`}
                        value={!!t.online && t.online_device_id === deviceId}
                        disabled={toggling === t.id || (t.online && t.online_device_id !== deviceId)}
                        onValueChange={(v) => toggleOnline(t, v)}
                        trackColor={{ true: colors.brand, false: colors.borderStrong }}
                      />
                    </View>
                  )}
                </Card>
              </Animated.View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomPicker
        sheetRef={truckTypePicker.ref}
        title="Truck type"
        value={truckType}
        onChange={setTruckType}
        items={catalog.truck_types.map((t: string) => ({ value: t, label: t, icon: "car-outline" }))}
      />
      <BottomPicker
        sheetRef={bodyTypePicker.ref}
        title="Body type"
        value={bodyType}
        onChange={setBodyType}
        items={catalog.body_types.map((t: string) => ({ value: t, label: t }))}
      />
    </View>
  );
}

function PhotoTile({ label, uri, onPick, icon, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPick} style={styles.photoTile}>
      {uri ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={styles.photoOverlay}>
            <Ionicons name="camera-outline" size={16} color={colors.onSurfaceInverse} />
            <Text style={{ ...type.small, color: colors.onSurfaceInverse, fontWeight: "600" }}>Change</Text>
          </View>
        </>
      ) : (
        <View style={{ alignItems: "center", gap: 6, padding: 8 }}>
          <Ionicons name={icon} size={26} color={colors.onSurfaceMuted} />
          <Text style={{ ...type.small, color: colors.onSurfaceMuted, textAlign: "center" }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function SelectRow({ value, placeholder, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [{
      height: 52, paddingHorizontal: spacing.md,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      backgroundColor: colors.surface, flexDirection: "row", alignItems: "center",
    }, pressed && { opacity: 0.7 }]}>
      <Text style={{ ...type.body, color: value ? colors.onSurface : colors.onSurfaceDim, flex: 1 }}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.onSurfaceDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.divider },
  addBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", ...shadow.sm },
  formCard: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.sm,
  },
  sectionHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  truckCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, gap: spacing.md },
  truckIcon: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  truckThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.errorLight, alignItems: "center", justifyContent: "center" },
  rejectBox: { flexDirection: "row", gap: 6, alignItems: "flex-start", padding: 10, backgroundColor: colors.errorLight, borderRadius: radius.md },
  err: { ...type.small, color: colors.error, textAlign: "center", padding: spacing.md, backgroundColor: colors.errorLight, borderRadius: radius.md, marginBottom: spacing.md },
  photoTile: {
    flex: 1, height: 110, borderRadius: radius.md, overflow: "hidden",
    borderWidth: 1, borderColor: colors.border, borderStyle: "dashed",
    backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center",
  },
  photoOverlay: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.6)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
  },
  verifiedPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: colors.successLight, borderWidth: 1, borderColor: colors.success,
  },
  subRow: {
    flexDirection: "row", alignItems: "center", padding: 10,
    backgroundColor: colors.brandLight, borderRadius: radius.md, gap: 10,
  },
  onlineRow: {
    flexDirection: "row", alignItems: "center", padding: 10,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, gap: 10,
  },
});
