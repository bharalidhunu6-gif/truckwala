#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 11 — Twilio SMS phone login + booking improvements (main agent)

### Backend features to test
- [x] `POST /api/auth/phone/send-otp` — normalizes E.164 (+91 default), routes to Twilio SMS or dev fallback based on env creds. Returns `is_new_user`, `delivery`, `dev_otp` (only when delivery=="dev").
- [x] `POST /api/auth/phone/verify-otp` — verifies via Twilio Verify OR stored OTP; existing users → JWT login; new users → require `name`+`role` → creates user + JWT.
- [x] `POST /api/auth/logout` — sets `is_online:false`, `last_seen_at:now`.
- [x] Notifications WS — on connect sets `is_online:true`; on last-socket disconnect sets `is_online:false`.
- [x] `POST /api/bookings/accept/{quote_id}` now takes body `{payment_method: "razorpay"|"cod"}` and creates TWO OTPs (`pickup_otp`, `delivery_otp`), never a single `otp`.
- [x] `GET /api/bookings/mine` and `GET /api/bookings/{id}` mask `pickup_otp`/`delivery_otp` for drivers (they should never see them).
- [x] `POST /api/bookings/{bid}/status` — `in_transit` requires the PICKUP OTP; `delivered` requires the DELIVERY OTP. COD marks `payment_status:paid_cod` on delivered.
- [x] `POST /api/bookings/{bid}/cancel` — customer OR driver can cancel BEFORE pickup verified.
- [x] `GET /api/quotes/shipment/{sid}` for drivers now returns their OWN quote in full + all COMPETING quotes anonymized (price/eta only, `driver_name: "Competing operator"`, `is_mine: false`).
- [x] Shipment TTL reduced from 72h to 24h (`routers/shipments.py`).

### Frontend features to test
- [x] New `/phone-login` screen with 3-step flow: phone → OTP → (if new) profile capture (name+role). +91 country code chip. Resend timer. Dev-mode OTP inline hint.
- [x] Email `/login` screen now has "Continue with mobile number" button linking to `/phone-login`.
- [x] `AuthProvider.loginWithPhone(...)` wires the new endpoint and stores JWT.
- [x] `AuthProvider.logout()` calls `POST /api/auth/logout` best-effort before clearing local auth.
- [x] Shipment page shows a "How will you pay?" alert (Razorpay | COD | Cancel) before booking.
- [x] Driver's shipment view shows competing quotes as anonymized "Competing operator" chips with "Rival bid" tag.
- [x] Booking page shows TWO OTP chips (PICKUP + DELIVERY) to shipper with verified check-marks. Drivers see NO OTP values — only a "Secure handover" hint.
- [x] Driver: pickup-otp input on `confirmed` → in_transit; delivery-otp input on `in_transit` → delivered.
- [x] COD banner + tag on booking page; Razorpay pay button hidden when payment_method === "cod".
- [x] Cancel-booking button for either party before pickup verified.

### Twilio credentials (in `/app/backend/.env`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` set.
- Note: Twilio trial account — SMS only reaches numbers verified in Twilio console. Backend gracefully falls back to dev mode and returns `dev_otp` in the response so testing continues to work for arbitrary numbers.

## Iteration 12 — Subscriptions, COD-only, Vehicle Photos, Fake-GPS Guard, Beefy Admin (main agent)

### Backend features
- [x] `POST /api/trucks` now REQUIRES `vehicle_photo` + `rc_photo` (base64, ≤2 MB); rejects duplicate `reg_number` with `{code:"duplicate_reg_number"}` at 409.
- [x] Truck online toggle:
  - `POST /api/trucks/{id}/online` `{device_id}` — must be approved, non-banned, subscription active; refuses (409 `in_use_elsewhere`) if truck currently online on another device; flips whichever OTHER truck this device had online → offline.
  - `POST /api/trucks/{id}/offline`
- [x] Subscriptions router:
  - `GET /api/subscriptions/tiers` — 2 tiers (₹499 < 1500kg GVW; ₹999 ≥ 1500kg).
  - `POST /api/subscriptions/order` `{truck_id}` — creates Razorpay order + `db.subscriptions{status:pending}`.
  - `POST /api/subscriptions/verify` — verifies signature and marks active with `expires_at = max(now, prev_exp) + 30 days`.
  - `GET /api/subscriptions/truck/{truck_id}` — current status.
- [x] `POST /api/quotes` gated on active subscription → 402 `{code:"subscription_required"}` if expired. Also blocks banned trucks (403). Prevents duplicate quotes per shipment per driver (409).
- [x] `POST /api/bookings/accept/{quote_id}` — payment_method now HARDCODED to `cod` regardless of body (Truck Wala is COD-only).
- [x] On booking `delivered`, driver's `completed_trips` counter increments; `verified_badge` computed as `completed_trips ≥ 50 AND verification_status == "approved"`.
- [x] Complaints router:
  - `POST /api/complaints` `{booking_id, subject, message}` — shipper-only, snapshots `reg_number` + `driver_id`.
  - `GET /api/complaints/mine`
- [x] Admin router extended:
  - `GET /api/admin/trucks?status=&q=` — case-insensitive substring on `reg_number` + `owner_name`; each row augmented with `subscription`, `subscription_active`, `subscription_tier`, `completed_trips`, `verified_badge`, `complaints_open`, `owner_phone`.
  - `POST /api/admin/trucks/{id}/ban` (with reason) — flips truck offline, banned=true.
  - `POST /api/admin/trucks/{id}/unban`
  - `DELETE /api/admin/trucks/{id}` — hard delete.
  - `GET /api/admin/subscriptions?status=&q=` — search by reg_number/driver/txn.
  - `GET /api/admin/complaints?status=&q=` and `POST /api/admin/complaints/{id}/resolve`.
  - Extended `/api/admin/stats` with `trucks_banned`, `open_complaints`, `active_subscriptions`.
- [x] MongoDB unique index on `trucks.reg_number` + compound index on `subscriptions(truck_id, expires_at)`.
- [x] Razorpay `.env` updated with live TEST keys (`rzp_test_TJmH8syGadq9dJ`); mock-mode auto-disabled.

### Frontend features
- [x] `/subscribe/[truck_id]` — full subscription screen with 2 tiers, current status banner, Razorpay WebView checkout, mock-mode auto-verify.
- [x] `DriverTrucks.tsx` rewritten:
  - Vehicle photo + RC photo mandatory pickers on the add-truck form.
  - Duplicate reg_number error rendered inline.
  - Online/offline `<Switch>` per truck — disabled when subscription expired, banned, or held by another device. Confirms via GPS guard.
  - Subscription status card per truck with "Renew" / "Subscribe" button routing to `/subscribe/[truck_id]`.
  - Verified badge chip when `verified_badge === true`.
- [x] `/complaints/new?booking_id=...` — shipper file-a-complaint screen. Reason chips + free-text.
- [x] Booking page:
  - Razorpay pay button gone (COD only).
  - "Report an issue" button routes to complaint form.
- [x] Shipment page (driver bid form):
  - **Anti-fake-bidding warning banner**: "⚠️ Fair bidding notice…"
  - Fake-GPS check before submitting a quote — blocks with alert + "Open Settings" shortcut.
  - Subscription-required alert with CTA to `/subscribe/[truck_id]`.
- [x] Admin panel:
  - `admin/trucks.tsx` — Search bar (reg number / owner), 6 stat chips (Pending / Approved / Rejected / Banned / Complaints / Active subs), photo previews (vehicle + RC) with tap-to-zoom, Approve / Reject / Ban / Unban / Delete buttons, subscription + txn IDs inline, "N complaints" chip on troubled trucks, `VERIFIED` badge after 50 trips, quick-nav icons to Subscriptions + Complaints.
  - `admin/subscriptions.tsx` — search by vehicle/driver/txn, filter by status, txn IDs displayed.
  - `admin/complaints.tsx` — search + status filter, resolve/dismiss with resolution note.
- [x] **Fake GPS detection** (`src/gpsGuard.ts`):
  - `checkFakeGps()` gets a foreground fix and inspects `coords.mocked` (Android). Returns `{ok:false}` if a mock GPS app is detected.
  - `alertOnFakeGps()` — native alert with an "Open Settings" shortcut.
  - Integrated in: driver online toggle, driver quote submission.
  - Background location task also drops any mocked fix (defense in depth).
- [x] `src/deviceId.ts` — persistent per-install device ID stored in AsyncStorage, prefixed with platform + Android/iOS vendor id when available (via expo-application).

### Not changed / preserved
- Twilio SMS OTP (iter 11), COD banner + double OTP flow (iter 11), 24h shipment TTL, chat WS, background location, admin auth.

## Iteration 13 — Web admin + truck-model targeting + tier radius + call customer + keyboard fix (main agent)

### Backend features
- [x] `deps.py`: subscription tiers now carry `max_radius_km` (20 km small, 100 km large). New helper `driver_search_context(user_id)` returns the driver's `truck_types` list + `max_radius_km` (LARGEST across their approved trucks).
- [x] `POST /shipments`: new-load push notification now filters by (a) matching `truck_type` against the target driver's registered truck models AND (b) driver's tier radius (not hard-coded 100 km).
- [x] `GET /shipments/open`: returns `{items, context}` shape:
    - `context.max_radius_km` (driver's tier), `context.effective_radius_km`, `context.truck_types`, `context.show_all_types`
    - filters items so drivers only see shipments whose `truck_type` matches one of their registered trucks by default
    - new query flag `?show_all_types=true` bypasses model filter (browse-all mode)
    - effective radius = tier max, or a smaller client override; never larger than tier

### Frontend features
- [x] `home.tsx` (driver): consumes `{items, context}`; renders a "20km · 3 models" chip + "My models only / Showing all types" toggle. Load list heading now shows the ACTUAL effective radius (was hard-coded "100 km").
- [x] `booking/[id].tsx`: driver's customer info section now has a **tap-to-call** phone number (underlined brand text) AND a dedicated green phone-icon button (`call-customer-btn`) — both trigger `tel:${customer_phone}`.
- [x] `DriverTrucks.tsx`: fixed the keyboard-hiding-list bug. Added `Keyboard.addListener` to track `endCoordinates.height` and injects that as extra `paddingBottom` on the outer ScrollView so the last truck / photo tiles remain visible above the keyboard on both iOS and Android. Added `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="on-drag"`.
- [x] **Responsive web admin panel**:
    - New `src/admin/AdminShell.tsx` — sidebar navigation on wide screens (≥900 px or Platform.OS==='web'), pill-style top nav on mobile. Renders content in a 1180-px max-width centered column so tables/cards don't stretch on desktop monitors. Includes brand row + Dashboard/Vehicles/Subscriptions/Complaints navigation + user footer + logout.
    - New `/admin/index.tsx` — landing dashboard with 8 KPI tiles (Pending/Approved/Rejected/Banned/Complaints/Active-subs/Total-users/Total-bookings) each linking to the relevant list, hero welcome banner + Quick Actions row. Grid auto-adjusts to 2/3/4 columns based on width.
    - `admin/trucks.tsx` refactored to use AdminShell + 2-column vehicle grid on wide screens.
    - `admin/complaints.tsx` refactored to use AdminShell.
    - `admin/subscriptions.tsx` refactored to use AdminShell.
    - All admin routes automatically render mobile-optimized on phones, sidebar-desktop on tablets/browsers — no separate build/deploy.

### Verified on desktop (1440x900)
- Screenshot: `/tmp/admin_dash_wide.png` shows sidebar with Dashboard/Vehicles/Subscriptions/Complaints, welcome banner, 8 stat tiles laid out 3-per-row, quick action row, admin footer.
