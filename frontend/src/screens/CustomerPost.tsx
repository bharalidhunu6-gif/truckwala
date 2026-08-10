import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable, Image, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Button, Field, inputStyle } from "@/src/ui";
import { colors, spacing, type, radius, shadow } from "@/src/theme";
import { api } from "@/src/api";
import { BottomPicker, usePicker } from "@/src/pickers";
import { LocationPickerModal, PickedLocation } from "@/src/LocationPicker";
import { useNotificationSound } from "@/src/sound";

export default function CustomerPost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [catalog, setCatalog] = useState<any>({ truck_types: [], goods_categories: [] });
  const [goods, setGoods] = useState("Household shifting");
  const [truckType, setTruckType] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [packages, setPackages] = useState("1");
  const [pickupAddr, setPickupAddr] = useState("");
  const [pickupCity, setPickupCity] = useState("");
  const [pickupPincode, setPickupPincode] = useState("");
  const [pickupCoord, setPickupCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [dropAddr, setDropAddr] = useState("");
  const [dropCity, setDropCity] = useState("");
  const [dropPincode, setDropPincode] = useState("");
  const [dropCoord, setDropCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [showPicker, setShowPicker] = useState<"pickup" | "drop" | null>(null);
  const [loadDate, setLoadDate] = useState("");
  const playSound = useNotificationSound();
  const [instructions, setInstructions] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const goodsPicker = usePicker();
  const truckPicker = usePicker();

  const pickPhoto = useCallback(async () => {
    if (photos.length >= 5) return Alert.alert("Limit reached", "You can attach up to 5 photos.");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Photo access is required. Enable it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => { if (Platform.OS !== "web") { require("expo-linking").openSettings?.(); } } },
        ]
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.6,
      base64: true,
    });
    if (!res.canceled && res.assets?.[0]?.base64) {
      const uri = `data:image/jpeg;base64,${res.assets[0].base64}`;
      setPhotos((p) => [...p, uri]);
    }
  }, [photos.length]);

  useEffect(() => { api.catalog().then(setCatalog).catch(() => {}); }, []);

  const submit = useCallback(async () => {
    setErr("");
    if (!weight || !pickupCity || !dropCity || !loadDate) {
      return setErr("Please fill weight, pickup city, drop city and loading date");
    }
    setLoading(true);
    try {
      // Use GPS-picked coords if available, else synthesize deterministic ones from city.
      const seed = (s: string) => s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      const pLat = pickupCoord?.lat ?? 12 + (seed(pickupCity) % 20);
      const pLng = pickupCoord?.lng ?? 72 + (seed(pickupCity + "x") % 15);
      const dLat = dropCoord?.lat ?? 12 + (seed(dropCity) % 20);
      const dLng = dropCoord?.lng ?? 72 + (seed(dropCity + "x") % 15);
      const created = await api.createShipment({
        goods_category: goods,
        weight_kg: parseFloat(weight),
        packages: parseInt(packages || "1"),
        pickup_address: pickupAddr || pickupCity,
        pickup_city: pickupCity,
        pickup_pincode: pickupPincode || null,
        pickup_lat: pLat,
        pickup_lng: pLng,
        drop_address: dropAddr || dropCity,
        drop_city: dropCity,
        drop_pincode: dropPincode || null,
        drop_lat: dLat,
        drop_lng: dLng,
        loading_date: loadDate,
        truck_type_preferred: truckType,
        instructions,
        photos,
      });
      playSound("ok");
      router.replace(`/shipment/${created.id}`);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, [goods, truckType, weight, packages, pickupAddr, pickupCity, pickupPincode, pickupCoord, dropAddr, dropCity, dropPincode, dropCoord, loadDate, instructions, photos, router, playSound]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.topbar}>
          <View>
            <Text style={type.small}>Step 1 of 1</Text>
            <Text style={type.h2}>Post a shipment</Text>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <SectionCard title="Route" icon="map-outline">
            <Field label="Pickup location">
              <Pressable onPress={() => setShowPicker("pickup")} testID="pickup-picker" style={styles.gpsBtn}>
                <Ionicons name="location" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, fontWeight: "600" }} numberOfLines={1}>
                    {pickupAddr || "Tap to pick pickup on the map"}
                  </Text>
                  {(pickupCity || pickupPincode) ? (
                    <Text style={type.small} numberOfLines={1}>
                      {pickupCity}{pickupPincode ? ` · ${pickupPincode}` : ""}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceDim} />
              </Pressable>
            </Field>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 2 }}>
                <Field label="Pickup City">
                  <TextInput testID="post-pickup-city" value={pickupCity} onChangeText={setPickupCity} placeholder="Bangalore" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="PIN">
                  <TextInput testID="post-pickup-pin" value={pickupPincode} onChangeText={setPickupPincode} keyboardType="numeric" maxLength={10} placeholder="560001" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
            </View>

            <Field label="Drop location">
              <Pressable onPress={() => setShowPicker("drop")} testID="drop-picker" style={styles.gpsBtn}>
                <Ionicons name="flag" size={18} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, fontWeight: "600" }} numberOfLines={1}>
                    {dropAddr || "Tap to pick drop on the map"}
                  </Text>
                  {(dropCity || dropPincode) ? (
                    <Text style={type.small} numberOfLines={1}>
                      {dropCity}{dropPincode ? ` · ${dropPincode}` : ""}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceDim} />
              </Pressable>
            </Field>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 2 }}>
                <Field label="Drop City">
                  <TextInput testID="post-drop-city" value={dropCity} onChangeText={setDropCity} placeholder="Chennai" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="PIN">
                  <TextInput testID="post-drop-pin" value={dropPincode} onChangeText={setDropPincode} keyboardType="numeric" maxLength={10} placeholder="600001" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
            </View>
          </SectionCard>

          <SectionCard title="Goods" icon="cube-outline">
            <Field label="Category">
              <SelectRow testID="pick-goods" value={goods} placeholder="Select category" onPress={goodsPicker.open} />
            </Field>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field label="Weight (kg)">
                  <TextInput testID="post-weight" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="500" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Packages">
                  <TextInput testID="post-packages" value={packages} onChangeText={setPackages} keyboardType="numeric" placeholder="1" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
                </Field>
              </View>
            </View>
          </SectionCard>

          <SectionCard title="Schedule & preferences" icon="calendar-outline">
            <Field label="Loading Date" hint="YYYY-MM-DD">
              <TextInput testID="post-load-date" value={loadDate} onChangeText={setLoadDate} placeholder="2026-05-20" placeholderTextColor={colors.onSurfaceDim} style={inputStyle} />
            </Field>
            <Field label="Truck Type (optional)">
              <SelectRow testID="pick-truck" value={truckType || ""} placeholder="Any truck" onPress={truckPicker.open} />
            </Field>
            <Field label="Special instructions (optional)">
              <TextInput testID="post-instructions" value={instructions} onChangeText={setInstructions} placeholder="Fragile, need tarpaulin..." placeholderTextColor={colors.onSurfaceDim} style={[inputStyle, { minHeight: 80 }]} multiline />
            </Field>
          </SectionCard>

          <SectionCard title="Photos of goods" icon="camera-outline">
            <Text style={[type.small, { marginBottom: spacing.md }]}>
              Add up to 5 photos so operators can quote accurately.
            </Text>
            <View style={styles.photoGrid}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoWrap}>
                  <Image source={{ uri: p }} style={styles.photo} />
                  <Pressable
                    testID={`remove-photo-${i}`}
                    onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                    style={styles.photoRemove}
                  >
                    <Ionicons name="close" size={14} color={colors.onBrand} />
                  </Pressable>
                </View>
              ))}
              {photos.length < 5 && (
                <Pressable testID="add-photo-btn" onPress={pickPhoto} style={styles.photoAdd}>
                  <Ionicons name="camera-outline" size={26} color={colors.brand} />
                  <Text style={{ ...type.small, color: colors.brand, fontWeight: "700", marginTop: 4 }}>Add photo</Text>
                </Pressable>
              )}
            </View>
          </SectionCard>
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </ScrollView>

        <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button testID="post-submit" label="Post & get quotes" onPress={submit} loading={loading} leftIcon="send" fullWidth />
        </View>
      </KeyboardAvoidingView>

      <BottomPicker
        sheetRef={goodsPicker.ref}
        title="Select category"
        value={goods}
        onChange={setGoods}
        items={catalog.goods_categories.map((g: string) => ({ value: g, label: g }))}
      />
      <BottomPicker
        sheetRef={truckPicker.ref}
        title="Preferred truck type"
        value={truckType}
        onChange={setTruckType}
        items={[{ value: "", label: "Any truck", icon: "checkmark-circle-outline" }, ...catalog.truck_types.map((t: string) => ({ value: t, label: t, icon: "car-outline" }))]}
      />

      <LocationPickerModal
        visible={showPicker !== null}
        title={showPicker === "pickup" ? "Pickup location" : "Drop location"}
        initial={showPicker === "pickup" ? (pickupCoord || undefined) : (dropCoord || undefined)}
        onClose={() => setShowPicker(null)}
        onConfirm={(loc: PickedLocation) => {
          if (showPicker === "pickup") {
            setPickupCoord({ lat: loc.lat, lng: loc.lng });
            setPickupAddr(loc.address);
            if (loc.city) setPickupCity(loc.city);
            if (loc.pincode) setPickupPincode(loc.pincode);
          } else if (showPicker === "drop") {
            setDropCoord({ lat: loc.lat, lng: loc.lng });
            setDropAddr(loc.address);
            if (loc.city) setDropCity(loc.city);
            if (loc.pincode) setDropPincode(loc.pincode);
          }
          setShowPicker(null);
        }}
      />
    </View>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}><Ionicons name={icon} size={16} color={colors.brand} /></View>
        <Text style={type.h3}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function SelectRow({ value, placeholder, onPress, testID }: { value: string; placeholder: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.7 }]}>
      <Text style={{ ...type.body, color: value ? colors.onSurface : colors.onSurfaceDim, flex: 1 }}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.onSurfaceDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topbar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.divider },
  section: {
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    ...shadow.sm,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.md },
  sectionIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  selectRow: {
    height: 52, paddingHorizontal: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface, flexDirection: "row", alignItems: "center",
  },
  err: { ...type.small, color: colors.error, textAlign: "center", padding: spacing.md, marginHorizontal: spacing.lg, backgroundColor: colors.errorLight, borderRadius: radius.md, marginTop: spacing.md },
  stickyBar: {
    padding: spacing.lg,
    backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.divider,
  },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoWrap: { width: 92, height: 92, borderRadius: radius.md, overflow: "hidden", position: "relative" },
  photo: { width: "100%", height: "100%" },
  photoRemove: {
    position: "absolute", top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.error,
    alignItems: "center", justifyContent: "center",
  },
  photoAdd: {
    width: 92, height: 92, borderRadius: radius.md,
    borderWidth: 2, borderStyle: "dashed", borderColor: colors.brand,
    backgroundColor: colors.brandLight,
    alignItems: "center", justifyContent: "center",
  },
  gpsBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface,
  },
});
