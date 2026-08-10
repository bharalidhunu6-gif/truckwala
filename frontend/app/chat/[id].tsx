import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { api, getToken } from "@/src/api";
import { colors, spacing, type, radius, shadow } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Msg = {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  text: string;
  at: string;
};

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Load booking summary for header
  useEffect(() => {
    (async () => {
      try {
        const b = await api.getBooking(id!);
        setOtherName(user?.role === "driver" ? b.customer_name : b.driver_name);
      } catch {}
    })();
  }, [id, user?.role]);

  // Open WebSocket
  useEffect(() => {
    let live = true;
    (async () => {
      const token = await getToken();
      const wsUrl = BASE.replace(/^http/, "ws") + `/api/ws/chat/${id}?token=${encodeURIComponent(token || "")}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => { if (live) setConnected(true); };
      ws.onclose = () => { if (live) setConnected(false); };
      ws.onerror = () => { if (live) setConnected(false); };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === "history") {
            setMessages(data.messages || []);
            setLoading(false);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
          } else if (data.type === "message") {
            setMessages((prev) => [...prev, data]);
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
          }
        } catch {}
      };
    })();
    // Fallback: also load via REST after 3s in case WS fails
    const t = setTimeout(async () => {
      if (loading) {
        try { const m = await api.chatHistory(id!); setMessages(m); } catch {}
        setLoading(false);
      }
    }, 3000);
    return () => { live = false; clearTimeout(t); wsRef.current?.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: trimmed }));
      } else {
        const m = await api.sendMessage(id!, trimmed);
        setMessages((prev) => [...prev, m]);
      }
      setText("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.log("send err", e);
    } finally {
      setSending(false);
    }
  }, [text, id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.surface }}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="chat-back" style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={styles.avatar}>
            <Text style={{ ...type.body, color: colors.onBrand, fontWeight: "700" }}>
              {(otherName?.[0] || "?").toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.h3 }} numberOfLines={1}>{otherName || "Chat"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={[styles.presenceDot, { backgroundColor: connected ? colors.success : colors.warning }]} />
              <Text style={type.small}>{connected ? "Connected" : "Reconnecting..."}</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ padding: spacing.xxl, alignItems: "center" }}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.onSurfaceDim} />
              <Text style={{ ...type.body, marginTop: 8, fontWeight: "600" }}>Say hi 👋</Text>
              <Text style={type.small}>Messages you send are end-to-end within your booking.</Text>
            </View>
          ) : (
            messages.map((m, i) => {
              const mine = m.sender_id === user?.id;
              const prev = messages[i - 1];
              const showHeader = !prev || prev.sender_id !== m.sender_id;
              return (
                <View key={m.id} style={{ marginBottom: 4, alignItems: mine ? "flex-end" : "flex-start" }}>
                  {showHeader && !mine ? (
                    <Text style={styles.senderName}>{m.sender_name}</Text>
                  ) : null}
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[styles.bubbleText, mine && { color: colors.onBrand }]}>{m.text}</Text>
                  </View>
                  <Text style={styles.timeText}>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            testID="chat-input"
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            placeholderTextColor={colors.onSurfaceDim}
            style={styles.input}
            multiline
            maxLength={2000}
          />
          <Pressable testID="chat-send" onPress={send} disabled={sending || !text.trim()} style={({ pressed }) => [
            styles.sendBtn,
            (!text.trim() || sending) && { opacity: 0.4 },
            pressed && { opacity: 0.8 },
          ]}>
            <Ionicons name="send" size={18} color={colors.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, borderBottomWidth: 1, borderColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  presenceDot: { width: 8, height: 8, borderRadius: 4 },
  bubble: { maxWidth: "80%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg, marginTop: 2 },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { ...type.body, fontSize: 14 },
  senderName: { ...type.small, color: colors.onSurfaceDim, marginTop: 12, marginBottom: 2, marginLeft: 8 },
  timeText: { ...type.small, color: colors.onSurfaceDim, fontSize: 10, marginTop: 2, marginHorizontal: 4 },
  empty: { padding: spacing.xxl, alignItems: "center", gap: 4 },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    padding: spacing.md, paddingTop: spacing.md,
    backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.divider,
    ...shadow.sm,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    ...type.body,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
