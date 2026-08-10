import React, { createContext, useContext, useEffect, useState } from "react";
import { api, User, getStoredUser, clearAuth, saveAuth } from "./api";

type PhoneVerifyPayload = {
  phone: string;
  code: string;
  name?: string;
  role?: "customer" | "driver";
  email?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (body: any) => Promise<User>;
  loginWithPhone: (body: PhoneVerifyPayload) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState>({} as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await getStoredUser();
      if (u) setUser(u);
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.login({ email, password });
    await saveAuth(res.token, res.user);
    setUser(res.user);
    return res.user;
  };
  const register = async (body: any) => {
    const res = await api.register(body);
    await saveAuth(res.token, res.user);
    setUser(res.user);
    return res.user;
  };
  const loginWithPhone = async (body: PhoneVerifyPayload) => {
  const res = await api.phoneVerifyOtp(body);

  if (res.requires_profile) {
    return res;
  }

  if (res.token && res.user) {
    await saveAuth(res.token, res.user);
    setUser(res.user);
  }

  return res.user;
};
  const logout = async () => {
    // Best-effort server-side offline marker; never blocks local sign-out.
    try { await api.logout(); } catch {}
    await clearAuth();
    setUser(null);
  };
  const refresh = async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {}
  };
  return (
    <Ctx.Provider value={{ user, loading, login, register, loginWithPhone, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
