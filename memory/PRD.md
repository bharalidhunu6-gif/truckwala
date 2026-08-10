# FreightOS — Logistics Marketplace

## Overview
Cross-platform logistics marketplace: customers (shippers) post shipments with photos, matched with truck operators (drivers) who submit quotes on admin-approved trucks. Live GPS tracking (Google Maps + Directions), real-time chat (WebSocket), Razorpay payments. Uber-Freight-style UI.

## Tech Stack
- Frontend: Expo 54, expo-router, expo-image-picker, expo-location, @gorhom/bottom-sheet, react-native-webview, expo-image, expo-linear-gradient, react-native-reanimated
- Backend: FastAPI (REST + WebSocket), Motor (async Mongo), bcrypt, PyJWT, razorpay
- DB: MongoDB
- Payments: Razorpay (WebView; auto-mock when keys are placeholders)
- Maps: Google Maps JS + Directions API (in WebView) — `EXPO_PUBLIC_GOOGLE_MAPS_KEY`
- Chat: WebSocket at `/api/ws/chat/{booking_id}?token=<jwt>` (plus REST fallback)

## Roles
- **Customer**: post shipments (photos), view quotes, book, pay, track driver live, chat, rate.
- **Driver**: register trucks (needs admin approval), quote on open loads, share live GPS, chat, mark delivered via OTP, earnings.
- **Admin**: verify/reject trucks; view fleet stats.

## Key Flows
1. Register/login → JWT. Admin pre-seeded.
2. Customer posts shipment (goods, pickup/drop coords, up to 5 base64 photos).
3. Driver adds truck → `pending`; admin approves at `/admin/trucks`.
4. Driver submits quote from an approved truck; customer accepts → booking + 4-digit OTP.
5. Customer pays via Razorpay (mock until real keys). Real-time chat opens on booking.
6. Driver starts trip → taps **Share live location** (expo-location foreground). Customer sees driver marker on Google Maps with **Directions polyline + distance/duration overlay**. Polls every 15s.
7. Driver enters OTP → delivered. Customer rates trip.

## Backend Endpoints (`/api`)
- Auth: `/auth/register`, `/auth/login`, `/auth/me`
- Catalog: `/catalog`
- Trucks: `/trucks` (CRUD), guarded by verification for quotes
- Shipments: `/shipments`, `/shipments/mine`, `/shipments/open`, `/shipments/{id}` (photos: base64 array)
- Quotes: `/quotes`, `/quotes/shipment/{sid}`, `/quotes/mine`
- Bookings: `/bookings/accept/{qid}`, `/bookings/mine`, `/bookings/{id}`, `/bookings/{id}/status`
- Live GPS: `POST /bookings/{id}/location` (driver-only), `GET /bookings/{id}/location`
- **Chat REST**: `GET /chat/{booking_id}/messages`, `POST /chat/{booking_id}/messages`
- **Chat WS**: `WS /api/ws/chat/{booking_id}?token=<jwt>` (history+broadcast)
- Ratings: `POST /ratings`, `GET /ratings/user/{uid}`
- Earnings: `GET /earnings/summary`
- Payments: `POST /pay/order`, `POST /pay/verify`
- Admin: `/admin/stats`, `/admin/trucks`, `/admin/trucks/{id}/verify`, `/admin/trucks/{id}/reject`

## Startup Migrations
- **admin seed**: creates `admin@freightos.app / admin1234` if missing.
- **truck backfill**: sets `verification_status="approved"` on legacy trucks missing the field (idempotent).

## Environment Vars
- Backend `.env`: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
- Frontend `.env`: `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY`.

## Known Behavior
- Payments run in **MOCK MODE** until real `rzp_test_*` keys are placed in backend `.env`.
- Location sharing:
  - **In a native / development build**: driver taps "Share live location" once and location updates every ~15s / 100m in background via `expo-task-manager` + `expo-location`. A persistent notification is shown ("FreightOS trip is live"). Auto-stops on delivery.
  - **In Expo Go**: falls back to a manual foreground ping per tap (background tasks are not supported in Expo Go).

## Not in MVP
- OTP mobile login / Google Sign-In
- Voice calls
- Photo storage on S3/Cloudinary (currently base64 in Mongo)
- Push notifications
