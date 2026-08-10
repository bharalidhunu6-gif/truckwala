import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "./theme";

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";

export type MapPoint = { lat: number; lng: number; label?: string; type?: "pickup" | "drop" | "driver" };

/**
 * Google Maps with real driving directions between pickup and drop
 * (via Directions API). Driver marker (if provided) overlays the route.
 * Reports back distance & duration via postMessage.
 */
export function LiveMap({ points, height = 260 }: { points: MapPoint[]; height?: number }) {
  const [meta, setMeta] = useState<{ distance?: string; duration?: string }>({});
  const html = useMemo(() => buildMapHtml(points, KEY), [points]);

  const onMessage = (e: any) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "directions") setMeta({ distance: data.distance, duration: data.duration });
    } catch {}
  };

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={["*"]}
        source={{ html }}
        style={{ flex: 1, backgroundColor: colors.surfaceMuted }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        onMessage={onMessage}
      />
      {(meta.distance || meta.duration) && (
        <View style={styles.metaPill}>
          <Ionicons name="navigate" size={12} color={colors.onBrand} />
          <Text style={styles.metaText}>{meta.distance} · {meta.duration}</Text>
        </View>
      )}
    </View>
  );
}

function buildMapHtml(points: MapPoint[], key: string) {
  const pointsJson = JSON.stringify(points);
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#f0f2f5;font-family:-apple-system,sans-serif}
.err{padding:20px;color:#5B6675;font-size:13px;text-align:center}
</style></head><body>
<div id="map"></div>
<script>
window.__pts = ${pointsJson};
function postMsg(payload){ try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch(e){} }
function init() {
  const pts = window.__pts || [];
  if (!pts.length) { document.body.innerHTML = '<div class="err">No location data</div>'; return; }
  const map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: pts[0].lat, lng: pts[0].lng }, zoom: 8,
    disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
    styles: [
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] }
    ]
  });
  const bounds = new google.maps.LatLngBounds();
  const colorFor = (t) => t === 'pickup' ? '#0A5AF0' : t === 'drop' ? '#0AA65B' : '#EA580C';
  const pickup = pts.find(p => p.type === 'pickup');
  const drop = pts.find(p => p.type === 'drop');
  const driver = pts.find(p => p.type === 'driver');

  // Custom markers for pickup/drop/driver
  pts.forEach(p => {
    const marker = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map, title: p.label || '',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: p.type === 'driver' ? 11 : 10,
        fillColor: colorFor(p.type), fillOpacity: 1,
        strokeWeight: 3, strokeColor: '#fff'
      },
      zIndex: p.type === 'driver' ? 3 : 2,
    });
    bounds.extend(marker.getPosition());
  });

  // Directions between pickup and drop
  if (pickup && drop) {
    const ds = new google.maps.DirectionsService();
    const dr = new google.maps.DirectionsRenderer({
      map, suppressMarkers: true, preserveViewport: true,
      polylineOptions: { strokeColor: '#0A5AF0', strokeOpacity: 0.9, strokeWeight: 4 },
    });
    ds.route({
      origin: { lat: pickup.lat, lng: pickup.lng },
      destination: { lat: drop.lat, lng: drop.lng },
      travelMode: google.maps.TravelMode.DRIVING,
    }, (res, status) => {
      if (status === 'OK' && res) {
        dr.setDirections(res);
        const leg = res.routes[0].legs[0];
        postMsg({ type: 'directions', distance: leg.distance.text, duration: leg.duration.text });
        const rBounds = res.routes[0].bounds;
        if (rBounds) map.fitBounds(rBounds, 40);
      } else {
        // Fallback straight line
        new google.maps.Polyline({
          path: [{ lat: pickup.lat, lng: pickup.lng }, { lat: drop.lat, lng: drop.lng }],
          geodesic: true, strokeColor: '#0B0F14', strokeOpacity: 0.5, strokeWeight: 3, map,
        });
        if (pts.length > 1) map.fitBounds(bounds, 40);
      }
    });
  } else if (pts.length > 1) {
    map.fitBounds(bounds, 40);
  }
}
window.gm_authFailure = function() { document.body.innerHTML = '<div class="err">Map failed to load. Check API key.</div>'; };
</script>
<script async defer src="https://maps.googleapis.com/maps/api/js?key=${key}&callback=init"></script>
</body></html>`;
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg, overflow: "hidden",
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted,
    position: "relative",
  },
  metaPill: {
    position: "absolute", top: 10, right: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brand,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  metaText: { ...type.small, color: colors.onBrand, fontWeight: "700", fontSize: 11 },
});
