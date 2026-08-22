import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "./auth";
import { getToken } from "./api";
import { useNotificationSound } from "./sound";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export type Notif = {
  type: "new_load" | "new_quote" | "booking_accepted" | "booking_status" | "ready";
  at?: string;
  [k: string]: any;
};

const Ctx = createContext<{ last: Notif | null; connected: boolean }>({ last: null, connected: false });

/**
 * Opens a single per-user WebSocket to /api/ws/notifications and plays a
 * two-tone chirp on every incoming push. Reconnects on backgrounded → foreground.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const play = useNotificationSound();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<Notif | null>(null);
  const reconnectRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      if (!user) return;
      const token = await getToken();
      if (!token) return;
      const url = BASE.replace(/^http/, "ws") + `/api/ws/notifications?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { if (!cancelled) setConnected(true); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        // Auto-reconnect after 4s
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 4000);
      };
      ws.onerror = () => { /* onclose will handle */ };
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as Notif;
          if (data.type === "ready") return;
          setLast(data);
          play();
        } catch { /* ignore */ }
      };
    };

    connect();

    // Reconnect when app comes back to foreground.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && wsRef.current?.readyState !== WebSocket.OPEN) connect();
    });

    return () => {
      cancelled = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      sub.remove();
    };
  }, [user, play]);

  return <Ctx.Provider value={{ last, connected }}>{children}</Ctx.Provider>;
}

export const useNotifications = () => useContext(Ctx);
