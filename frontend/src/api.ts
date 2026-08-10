import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY = "fos_token";
const USER_KEY = "fos_user";

export type Role = "customer" | "driver" | "admin";
export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  avg_rating?: number;
  verified?: boolean;
  requires_profile?: boolean;
};

export async function saveAuth(token: string, user: User) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}
export async function clearAuth() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}
export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function getStoredUser(): Promise<User | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as User) : null;
}

async function req(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const headers: any = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    // FastAPI puts structured errors in `detail` (dict) or a string.
    const detail = data?.detail;
    const msg = typeof detail === "string"
      ? detail
      : detail?.message || data?.message || `Request failed (${res.status})`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.code = typeof detail === "object" ? detail?.code : undefined;
    err.detail = detail;
    throw err;
  }
  return data;
}

export const api = {
  register: (body: any) => req("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: any) => req("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => req("/auth/logout", { method: "POST" }),
  me: () => req("/auth/me"),
  // Phone (SMS OTP) auth
  phoneSendOtp: (phone: string, purpose: "login" | "register" = "login") =>
    req("/auth/phone/send-otp", { method: "POST", body: JSON.stringify({ phone, purpose }) }),
  phoneVerifyOtp: (body: { phone: string; code: string; name?: string; role?: "customer" | "driver"; email?: string }) =>
    req("/auth/phone/verify-otp", { method: "POST", body: JSON.stringify(body) }),
  catalog: () => req("/catalog"),
  // Trucks
  createTruck: (body: any) => req("/trucks", { method: "POST", body: JSON.stringify(body) }),
  myTrucks: () => req("/trucks/mine"),
  deleteTruck: (id: string) => req(`/trucks/${id}`, { method: "DELETE" }),
  setTruckOnline: (id: string, device_id: string) =>
    req(`/trucks/${id}/online`, { method: "POST", body: JSON.stringify({ device_id }) }),
  setTruckOffline: (id: string) =>
    req(`/trucks/${id}/offline`, { method: "POST" }),
  // Subscriptions
  subTiers: () => req("/subscriptions/tiers"),
  mySubs: () => req("/subscriptions/mine"),
  truckSubStatus: (tid: string) => req(`/subscriptions/truck/${tid}`),
  subOrder: (truck_id: string) => req("/subscriptions/order", { method: "POST", body: JSON.stringify({ truck_id }) }),
  subVerify: (body: any) => req("/subscriptions/verify", { method: "POST", body: JSON.stringify(body) }),
  // Complaints
  fileComplaint: (body: { booking_id: string; subject: string; message: string }) =>
    req("/complaints", { method: "POST", body: JSON.stringify(body) }),
  myComplaints: () => req("/complaints/mine"),
  // Shipments
  createShipment: (body: any) => req("/shipments", { method: "POST", body: JSON.stringify(body) }),
  myShipments: () => req("/shipments/mine"),
  openShipments: (lat?: number, lng?: number, opts: { show_all_types?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (lat != null && lng != null) { qs.set("lat", String(lat)); qs.set("lng", String(lng)); }
    if (opts.show_all_types) qs.set("show_all_types", "true");
    const q = qs.toString();
    return req(`/shipments/open${q ? "?" + q : ""}`);
  },
  getShipment: (id: string) => req(`/shipments/${id}`),
  // Quotes
  submitQuote: (body: any) => req("/quotes", { method: "POST", body: JSON.stringify(body) }),
  shipmentQuotes: (sid: string) => req(`/quotes/shipment/${sid}`),
  myQuotes: () => req("/quotes/mine"),
  acceptQuote: (qid: string, payment_method: "razorpay" | "cod" = "razorpay") =>
    req(`/bookings/accept/${qid}`, { method: "POST", body: JSON.stringify({ payment_method }) }),
  // Bookings
  myBookings: () => req("/bookings/mine"),
  getBooking: (id: string) => req(`/bookings/${id}`),
  cancelBooking: (id: string) => req(`/bookings/${id}/cancel`, { method: "POST" }),
  setBookingStatus: (id: string, status: string, otp?: string) => {
    const qs = new URLSearchParams({ status, ...(otp ? { otp } : {}) }).toString();
    return req(`/bookings/${id}/status?${qs}`, { method: "POST" });
  },
  updateLocation: (id: string, lat: number, lng: number) =>
    req(`/bookings/${id}/location`, { method: "POST", body: JSON.stringify({ lat, lng }) }),
  getLocation: (id: string) => req(`/bookings/${id}/location`),
  // Chat
  chatHistory: (bookingId: string) => req(`/chat/${bookingId}/messages`),
  sendMessage: (bookingId: string, text: string) => req(`/chat/${bookingId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  // Ratings
  rate: (body: any) => req("/ratings", { method: "POST", body: JSON.stringify(body) }),
  // Earnings
  earnings: () => req("/earnings/summary"),
  // Admin API
  adminStats: () => req("/admin/stats"),
  adminTrucks: (status?: string, q?: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return req(`/admin/trucks${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  adminTruckDetail: (id: string) => req(`/admin/trucks/${id}`),
  adminApproveTruck: (id: string) => req(`/admin/trucks/${id}/verify`, { method: "POST" }),
  adminRejectTruck: (id: string, reason: string) => req(`/admin/trucks/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminBanTruck: (id: string, reason: string) => req(`/admin/trucks/${id}/ban`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminUnbanTruck: (id: string) => req(`/admin/trucks/${id}/unban`, { method: "POST" }),
  adminDeleteTruck: (id: string) => req(`/admin/trucks/${id}`, { method: "DELETE" }),
  adminSubscriptions: (status?: string, q?: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return req(`/admin/subscriptions${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  adminComplaints: (status?: string, q?: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    return req(`/admin/complaints${qs.toString() ? `?${qs.toString()}` : ""}`);
  },
  adminResolveComplaint: (id: string, resolution: string, action: "resolve" | "dismiss" = "resolve") =>
    req(`/admin/complaints/${id}/resolve`, { method: "POST", body: JSON.stringify({ resolution, action }) }),
 // OTP + Password
otpSend: (
  identifier: string,
  purpose: "register" | "reset" = "register"
) => {
  if (purpose === "reset") {
    return req("/auth/phone/send-otp", {
      method: "POST",
      body: JSON.stringify({
        phone: identifier,
        purpose: "reset",
      }),
    });
  }

  return req("/auth/otp/send", {
    method: "POST",
    body: JSON.stringify({
      identifier,
      purpose,
    }),
  });
},

otpVerify: (
  identifier: string,
  code: string,
  purpose: "register" | "reset" = "register"
) => {
  if (purpose === "reset") {
    return req("/auth/phone/verify-otp", {
      method: "POST",
      body: JSON.stringify({
        phone: identifier,
        code,
      }),
    });
  }

  return req("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({
      identifier,
      code,
      purpose,
    }),
  });
},

resetPassword: (
  phone: string,
  code: string,
  new_password: string
) =>
  req("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      phone,
      code,
      new_password,
    }),
  }),

  // Payments
  createOrder: (booking_id: string) => req("/pay/order", { method: "POST", body: JSON.stringify({ booking_id }) }),
  verifyPayment: (body: any) => req("/pay/verify", { method: "POST", body: JSON.stringify(body) }),
};