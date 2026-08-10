import { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator, TextInput, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { colors, spacing, type, radius, shadow } from "./theme";
import { Button, inputStyle } from "./ui";

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";

export type PickedLocation = { lat: number; lng: number; address: string; city?: string; pincode?: string };

/**
 * Full-screen Google Maps picker. Users can:
 * - Tap the map to drop a pin
 * - Search by keyword (Places API autocomplete)
 * - Use "My location" (expo-location)
 * On confirm we reverse-geocode server-side (via Google JS API) to fill the
 * address, city and postal_code, then hand the result to onConfirm.
 */
export function LocationPickerModal({
  visible,
  title,
  initial,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  initial?: { lat: number; lng: number };
  onClose: () => void;
  onConfirm: (loc: PickedLocation) => void;
}) {
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const html = useMemo(() => buildPickerHtml(KEY, initial), [initial]);

  const onMessage = useCallback((evt: any) => {
    try {
      const data = JSON.parse(evt.nativeEvent.data);
      if (data.type === "picked") {
        setPicked({
          lat: data.lat, lng: data.lng,
          address: data.address || "",
          city: data.city || "",
          pincode: data.pincode || "",
        });
      }
    } catch {}
  }, []);

  const webRef = useState<any>(null)[0]; // holder — set imperatively via ref? Not needed if we injectJs via key
  const [webKey, setWebKey] = useState(0);

  const useMyLocation = async () => {
    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { Alert.alert("Permission needed", "Location access is required."); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      // Force map to recenter by remounting webview with fresh initial coords
      setPickedLocation(loc.coords.latitude, loc.coords.longitude);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  };

  const setPickedLocation = (lat: number, lng: number) => {
    setPicked({ lat, lng, address: "" });
    setWebKey((k) => k + 1);
    (initial as any) = { lat, lng }; // hack to change useMemo dep — actually pass via a state
    setForceInitial({ lat, lng });
  };

  const [forceInitial, setForceInitial] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const htmlKeyed = useMemo(() => buildPickerHtml(KEY, forceInitial || initial), [webKey, forceInitial, initial]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} testID="picker-close" style={styles.iconBtn}>
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={type.h3}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.onSurfaceDim} />
          <TextInput
            testID="picker-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search area, landmark..."
            placeholderTextColor={colors.onSurfaceDim}
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => setWebKey((k) => k + 1)}
          />
          <Pressable onPress={useMyLocation} testID="picker-my-location" style={styles.locBtn}>
            {loading ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name="locate" size={18} color={colors.brand} />}
          </Pressable>
        </View>

        <WebView
          key={webKey}
          originWhitelist={["*"]}
          source={{ html: htmlKeyed }}
          style={{ flex: 1, backgroundColor: colors.surfaceMuted }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={`window.__searchTerm = ${JSON.stringify(search)};`}
        />

        <View style={styles.footer}>
          {picked ? (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={type.small}>SELECTED</Text>
              <Text style={{ ...type.body, fontWeight: "600" }} numberOfLines={2}>{picked.address || `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`}</Text>
              <Text style={type.small}>
                {picked.city}{picked.pincode ? ` · ${picked.pincode}` : ""}
              </Text>
            </View>
          ) : (
            <Text style={[type.small, { marginBottom: spacing.md, textAlign: "center" }]}>Tap on the map to drop a pin, or use search.</Text>
          )}
          <Button
            testID="picker-confirm"
            label="Confirm location"
            leftIcon="checkmark-outline"
            disabled={!picked}
            onPress={() => picked && onConfirm(picked)}
            fullWidth
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function buildPickerHtml(key: string, initial?: { lat: number; lng: number }) {
  const c = initial ? `{lat:${initial.lat},lng:${initial.lng}}` : `{lat:20.5937,lng:78.9629}`; // India centroid
  const zoom = initial ? 14 : 5;
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#f0f2f5}</style>
</head><body>
<div id="map"></div>
<script>
let map, marker;
function post(payload){ try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch(e){} }
function reverse(lat, lng) {
  const gc = new google.maps.Geocoder();
  gc.geocode({ location: { lat, lng } }, (results, status) => {
    if (status === 'OK' && results && results[0]) {
      const r = results[0];
      let city = '', pincode = '';
      (r.address_components || []).forEach(c => {
        if (c.types.includes('locality')) city = c.long_name;
        if (!city && c.types.includes('administrative_area_level_2')) city = c.long_name;
        if (c.types.includes('postal_code')) pincode = c.long_name;
      });
      post({ type: 'picked', lat, lng, address: r.formatted_address, city, pincode });
    } else {
      post({ type: 'picked', lat, lng, address: '', city: '', pincode: '' });
    }
  });
}
function place(lat, lng) {
  const p = { lat, lng };
  if (!marker) marker = new google.maps.Marker({ position: p, map, draggable: true });
  else marker.setPosition(p);
  marker.addListener('dragend', () => {
    const q = marker.getPosition();
    reverse(q.lat(), q.lng());
  });
  reverse(lat, lng);
}
function init() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: ${c}, zoom: ${zoom},
    disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
  });
  map.addListener('click', (e) => place(e.latLng.lat(), e.latLng.lng()));
  ${initial ? `place(${initial.lat}, ${initial.lng});` : ''}
  const term = window.__searchTerm || '';
  if (term) {
    const svc = new google.maps.places.PlacesService(map);
    svc.textSearch({ query: term }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const p = results[0].geometry.location;
        map.setCenter(p); map.setZoom(14);
        place(p.lat(), p.lng());
      }
    });
  }
}
window.gm_authFailure = function() { document.body.innerHTML = '<div style="padding:20px">Map failed to load</div>'; };
</script>
<script async defer src="https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&callback=init"></script>
</body></html>`;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md, borderBottomWidth: 1, borderColor: colors.divider, backgroundColor: colors.surfaceAlt },
  searchInput: { flex: 1, height: 40, paddingHorizontal: 10, ...type.body, color: colors.onSurface },
  locBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandLight, alignItems: "center", justifyContent: "center" },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface, ...shadow.md },
});
