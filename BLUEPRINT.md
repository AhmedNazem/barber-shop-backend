# BarberOS Backend Blueprint

**Why:** Every frontend page is built against mock data and BFF stubs. This document is the authoritative reference for what the real Express backend must implement — derived directly from the frontend static pages.
**How to apply:** When building any backend endpoint, cross-reference the "Frontend Mock" column to ensure the real API returns the exact shape the frontend expects.

---

## Stack

- **Runtime:** Node.js + Express.js
- **ORM:** Prisma + PostgreSQL
- **Auth:** JWT (access token 15min + refresh token 7 days), bcrypt 10+ rounds
- **Jobs:** BullMQ + Redis (hair analysis, email notifications)
- **Storage:** S3-compatible (photos, logos, portfolios)
- **Payments:** ZainCash, FIB (First Iraqi Bank), PayTabs Iraq

---

## Classification Key

- **NEEDS BACKEND** — page uses mock/localStorage data, must be replaced with real API
- **BFF STUB EXISTS** — Next.js BFF route exists at `app/api/...` with TODO comment, ready to wire
- **STATIC ONLY** — page is purely presentational, no backend needed ever

---

## 1. Authentication

### Frontend Mock State
- Auth model: **phone + WhatsApp OTP** — no email/password for customers or barbers.
- `app/api/auth/request-otp` — dev: stores `{phone, otp:'123456'}` in `dev_otp_pending` cookie.
- `app/api/auth/verify-otp` — dev whitelist: `+9647700000001`→customer, `...2`→barber, `...3`→shop_owner, `...4`→admin. Sets `dev_session` cookie.
- `app/api/auth/logout` — clears `barber_token` + `dev_session` cookies. No backend call needed.
- `lib/auth/session.ts` `getSession()` — reads `barber_token` → calls `API_URL/auth/me`. Falls back to `dev_session` in dev.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| POST | `/auth/request-otp` | `{ phone, name?, shopName?, isRegister? }` | `{ ok: true }` — sends WhatsApp OTP (Unifonic/Twilio) |
| POST | `/auth/verify-otp` | `{ phone, otp, name?, shopName?, isRegister? }` | `{ accessToken, refreshToken, role }` |
| POST | `/auth/refresh` | `{ refreshToken }` (cookie or body) | `{ accessToken }` |
| POST | `/auth/logout` | Bearer token | `{ ok: true }` — revoke refresh token |
| GET | `/auth/me` | Bearer token | `{ id, phone, name, role, shopStatus? }` |

**BFF Integration:**
- `app/api/auth/request-otp` → `${API_URL}/auth/request-otp`
- `app/api/auth/verify-otp` → `${API_URL}/auth/verify-otp`, sets `barber_token` httpOnly cookie
- `getSession()` GETs `${API_URL}/auth/me` with `barber_token` as Bearer

### Barber Invite Flow

Barbers cannot self-register. Shop owner creates a barber record in `/dashboard/staff`, then generates an invite link. The barber uses the link to register their phone + OTP.

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| POST | `/auth/invite/generate` | Owner JWT | `{ staffId }` | `{ inviteUrl: string }` — one-time code, 48h TTL |
| GET | `/auth/invite` | None | `?code=` | `{ valid: bool, shopName, barberName }` |
| POST | `/auth/invite/accept` | None | `{ code, phone, otp, name }` | `{ accessToken, refreshToken, role: 'barber' }` — links User to Barber record |

### Shop Owner Pending Approval

After completing the onboarding wizard, the shop enters `PENDING` status. Admin approves or rejects from the admin panel.

| Method | Route | Auth | Output |
|---|---|---|---|
| GET | `/shop/status` | Owner JWT | `{ status: 'pending'\|'approved'\|'rejected'\|'suspended', rejectionReason? }` |
| PATCH | `/admin/shops/:id/approve` | Admin JWT | Sets `ShopStatus → APPROVED`, triggers approval notification |
| PATCH | `/admin/shops/:id/reject` | Admin JWT + `{ reason }` | Sets `ShopStatus → REJECTED`, triggers rejection notification |
| PATCH | `/admin/shops/:id/suspend` | Admin JWT + `{ reason }` | Runs suspension transaction (see below) |

**Guard rule:** Express middleware on all `/dashboard/*` routes checks `shop.status === APPROVED`. Returns `403 { error: 'shop_pending' | 'shop_rejected' | 'shop_suspended' }` otherwise. Frontend reads the error code and renders the correct screen.

**Resubmit rule:** When a rejected shop owner completes the onboarding wizard again, the backend must reset `shop.status = PENDING`. The frontend has no special resubmit endpoint — it reuses the existing onboarding wizard completion flow. Backend must detect that the shop already exists (by owner JWT) and update rather than create.

### Suspension Transaction Logic

`PATCH /admin/shops/:id/suspend` must run the following in a **single Prisma transaction**:

1. Set `shop.status = SUSPENDED`, save `reason` + `suspendedAt` on the Shop record.
2. **Confirmed bookings** (`status = CONFIRMED`, future date) — leave untouched. Shop must still serve these customers. New bookings blocked.
3. **Pending bookings** (`status = PENDING`) — set `status = CANCELLED`, set `cancelledBy = 'admin'`, set `cancellationReason = 'shop_suspended'`.
4. **Deposits on cancelled pending bookings** — set `deposit.refundStatus = PENDING_REFUND`. Queue a BullMQ job `process-refund` for each.
5. Notify each affected customer via in-app notification (+ WhatsApp if enabled): *"Your booking at [shop] has been cancelled due to a platform action. Your deposit will be refunded within 3–5 business days."*
6. Notify shop owner: *"Your shop has been suspended. Reason: [reason]."*

**Pre-suspension info endpoint** (called by admin frontend before showing the confirm dialog):

| Method | Route | Auth | Output |
|---|---|---|---|
| GET | `/admin/shops/:id/suspend-preview` | Admin JWT | `{ activeBookings: number, pendingBookings: number, pendingDepositsIQD: number }` |

Frontend uses this to populate the warning banners in the confirm dialog.

### DB Models
```prisma
model User {
  id          String     @id @default(cuid())
  phone       String     @unique  // +964 format
  name        String
  role        UserRole   @default(CUSTOMER)
  shopId      String?    // set for BARBER and SHOP_OWNER
  createdAt   DateTime   @default(now())
}

model OtpCode {
  id        String   @id @default(cuid())
  phone     String
  code      String   // 6-digit, hashed
  expiresAt DateTime
  usedAt    DateTime?
  attempts  Int      @default(0)  // max 5 before lockout
}

model InviteCode {
  id        String   @id @default(cuid())
  shopId    String
  staffId   String   // Barber record pre-created by owner
  code      String   @unique
  expiresAt DateTime
  usedAt    DateTime?
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
}

enum UserRole   { CUSTOMER BARBER SHOP_OWNER ADMIN }
enum ShopStatus { PENDING APPROVED REJECTED SUSPENDED }
```

**Shop model addition:** Add `status ShopStatus @default(PENDING)` and `rejectionReason String?` to the `Shop` model.

---

## 1b. Admin — Users Management (`/admin/users`)

### Role Change Rules

Role changes via `PATCH /admin/users/:id/role` must enforce these constraints server-side:

| From | To | Allowed | Condition |
|---|---|---|---|
| `customer` | `barber` | **No** — use invite flow only | Barber must be linked to a shop via `InviteCode`. Direct role change leaves `shopId = null`, breaking the dashboard. |
| `customer` | `shop_owner` | **No** — never via role change alone | A `Shop` record must exist first. Use `POST /admin/shops` to create a shop and assign owner. |
| `barber` | `shop_owner` | **No** | Same — requires a Shop record. |
| `shop_owner` | `barber` | Admin discretion | Must clear `shopId` reassignment manually. |
| Any | `customer` | Yes | Revokes dashboard access. Invalidate session. |
| Any | `admin` | Superadmin only | Not exposed in the UI — DB-level only. |

### Session Invalidation on Role Change

When any role change is applied:
1. Delete all `RefreshToken` records for the user.
2. The user's current JWT will expire naturally (15 min). On next refresh attempt, token is rejected → forced re-login.
3. This ensures the new role takes effect within one session window without requiring immediate logout.

### Required Endpoints

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/admin/users` | Admin JWT | `?role=&search=&page=` | Paginated user list |
| GET | `/admin/users/:id` | Admin JWT | — | Full user profile + booking count + total spent + flags |
| PATCH | `/admin/users/:id/role` | Admin JWT | `{ role }` | Updated user — validates constraints above |
| PATCH | `/admin/users/:id/suspend` | Admin JWT | `{ reason }` | Sets `user.suspended = true`, invalidates sessions |
| DELETE | `/admin/users/:id` | Admin JWT | — | Soft-delete: anonymises PII, retains booking records for audit |

---

## 2. Shops Discovery (`/shops`)

### Frontend Mock State
**NEEDS BACKEND** — `components/shops/shops.constants.ts` DISCOVERY_SHOPS array (9 hardcoded shops)

**Shape the frontend expects (from DISCOVERY_SHOPS):**
```typescript
{
  id: string; name: string; nameAr: string;
  image: string;           // URL — currently single field used for both cover and logo thumbnail. Must be split into coverUrl + logoUrl when backend is wired (see note below)
  rating: number;          // e.g. 4.8
  reviewCount: number;
  distance: string;        // e.g. "1.2 km" (computed from user location)
  neighborhood: string; neighborhoodAr: string;
  services: string[];      // service keys: 'haircut','beard','shave',...
  priceRange: 'budget'|'mid'|'premium';
  lat: number; lng: number;
  isOpen: boolean;
  load: 'low' | 'medium' | 'high';  // Phase 15 — computed from live queue (see §23)
  discount?: DiscountRule;           // Phase 10 — see §17
}
```

**Filters used by `search-filter-bar.tsx`:**
- Text search (name/neighborhood)
- Service type (haircut/beard/shave/color/treatment/kids/hotTowel)
- Min rating (1–5)
- Max price (budget/mid/premium)
- Load / availability (`low` | `medium` | `high`) — Phase 15

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/shops` | `?search&service&minRating&priceRange&load&city&limit&offset` | `{ shops: Shop[], total, limit, offset }` |
| GET | `/shops/:id` | — | `Shop` with services, barbers, reviews (paginated), hours |
| POST | `/shops` | Owner JWT, body: `{ nameEn, nameAr, address, phone, city, lat, lng }` | `Shop` |
| PATCH | `/shops/:id` | Owner JWT | Updated `Shop` |
| POST | `/shops/:id/cover` | Multipart image (max 5MB) | `{ url: string }` — updates `Shop.coverUrl` |
| POST | `/shops/:id/logo` | Multipart image (max 2MB) | `{ url: string }` — updates `Shop.logoUrl` |

### DB Models
```prisma
model Shop {
  id          String   @id @default(cuid())
  ownerId     String
  nameEn      String
  nameAr      String
  address     String
  city        String
  phone       String
  lat         Float
  lng         Float
  coverUrl    String?  // shown as full-width banner in /shops/[id] ShopHeader
  logoUrl     String?  // shown as rounded square overlapping the cover in /shops/[id] ShopHeader
  // NOTE: frontend currently uses a single `image` field for both. When wiring backend,
  // update DiscoveryShop + ShopDetail types to use coverUrl + logoUrl separately.
  priceRange  PriceRange @default(MID)
  isActive    Boolean  @default(false)
  createdAt   DateTime @default(now())
  hours       BusinessHours[]
  services    Service[]
  barbers     Barber[]
}

model BusinessHours {
  id        String  @id @default(cuid())
  shopId    String
  dayOfWeek Int     // 0=Sun, 1=Mon ... 6=Sat
  openTime  String  // "09:00"
  closeTime String  // "20:00"
  isClosed  Boolean @default(false)
}

enum PriceRange { BUDGET MID PREMIUM }
```

---

## 3. Shop Detail (`/shops/[id]`)

### Frontend Mock State
**NEEDS BACKEND** — `shop-detail.constants.ts` (9 shops), `barbers.constants.ts` (18 barbers), `service-items.constants.ts` (7 services), `reviews.constants.ts` (27 reviews)

**Shape the frontend expects:**

**Services** (from SERVICE_CATALOG):
```typescript
{ key: string; nameEn: string; nameAr: string; durationMin: number; price: number; previewImages: string[]; modelSrc?: string; modelColor?: string; modelRotation?: [number,number,number] }
```

**Barbers** (from BARBERS_BY_SHOP):
```typescript
{ id: string; name: string; specialtyKey: string; avatar: string; isAvailable: boolean }
```

**Reviews** (from REVIEWS_BY_SHOP, page size 3):
```typescript
{ id: string; authorName: string; authorAvatar: string; rating: number; comment: string; commentAr: string; date: string; photos?: string[] }
```

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/shops/:id` | — | Shop + services[] + barbers[] |
| GET | `/shops/:id/reviews` | `?page&limit&minRating` | `{ reviews[], total, page }` |

### DB Models
```prisma
model Service {
  id          String   @id @default(cuid())
  shopId      String
  nameEn      String
  nameAr      String
  price       Int      // IQD
  durationMin Int
  category    String   // 'haircut'|'beard'|'shave'|'color'|'treatment'|'kids'|'hotTowel'
  coverUrl    String?
  isActive    Boolean  @default(true)
  photos      ServicePhoto[]
}

model ServicePhoto { id String @id; serviceId String; url String; order Int }

model Barber {
  id            String   @id @default(cuid())
  userId        String?  // nullable for external barbers
  shopId        String
  nameEn        String
  nameAr        String
  photoUrl      String?
  specialties   String[] // array of service category keys
  experienceYears Int    @default(0)
  isActive      Boolean  @default(true)
  schedule      BarberSchedule[]
  portfolio     BarberPortfolio[]
}

model BarberSchedule {
  id          String  @id @default(cuid())
  barberId    String
  dayOfWeek   Int     // 0-6
  startTime   String  // "09:00"
  endTime     String  // "20:00"
  isAvailable Boolean @default(true)
}

model BarberPortfolio { id String @id; barberId String; photoUrl String; order Int }
```

---

## 4. Barber Public Profile (`/barber/[id]`)

### Frontend Mock State
**NEEDS BACKEND** — `barber-profile.constants.ts` (14 profiles) + `barber-profile-extra.constants.ts` (reviews, availability, serviceKeys, portfolio)

**Shape the frontend expects** (from `resolveBarberProfile()`):
```typescript
{
  id: string; name: string; specialtyKey: string; avatar: string; isAvailable: boolean;
  shopId: string; shopName: string;
  yearsExp: number; avgRating: number; totalReviews: number;
  bio: string; bioAr: string;
  serviceKeys: string[];    // keys into SERVICE_CATALOG
  portfolio: string[];      // image URLs (up to 6)
  reviews: BarberReview[];  // { id, author, rating, comment, commentAr, date }
  availability: WeekAvailability; // Record<'mon'|...'sun', {from,to}|null>
}
```

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/barbers/:id` | — | Full barber profile (above shape) |
| GET | `/barbers/:id/reviews` | `?page&limit` | `{ reviews: BarberReview[], total }` |
| GET | `/barbers/:id/availability` | — | `WeekAvailability` |
| GET | `/barbers/:id/portfolio` | — | `string[]` (image URLs) |

---

## 5. Booking Wizard (`/booking`)

### Frontend Mock State
**NEEDS BACKEND** — Entire wizard runs against mock constants.

**Step 1 — Shop selection:** Uses DISCOVERY_SHOPS. Needs real `/shops` paginated endpoint.

**Step 2 — Services + Barber:** 
- Services: needs real `/shops/:id/services`
- Barbers: needs real `/shops/:id/barbers`

**Step 3 — Time slot:**
- Currently hardcoded 30-min slots for any date
- Needs real `/shops/:id/availability?date=YYYY-MM-DD&barberId=...` returning available time slots

**Step 4 — Deposit review:** Local calculation only (correct formula below).

**Step 5 / Checkout — Booking creation:** Currently stores to localStorage (`useAppointmentsStore`), no real booking in DB.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/shops/:id/availability` | `?date&barberId` | `{ slots: string[] }` (ISO times available) |
| POST | `/bookings` | Bearer JWT, `{ shopId, serviceIds[], barberId?, slot, paymentMethod }` | `{ bookingId, depositAmount, paymentReference }` |

### Booking Creation Business Logic
```
depositAmount = Math.round((subtotal * 0.2) / 250) * 250  // round to nearest 250 IQD
slot conflict: barber cannot have 2 overlapping confirmed bookings
```

### DB Models
```prisma
model Booking {
  id            String        @id @default(cuid())
  customerId    String
  shopId        String
  barberId      String?
  barberName    String?       // snapshot at booking time — barber name can change or barber can be removed
  slot          DateTime
  status        BookingStatus @default(UPCOMING)
  totalPrice    Int           // IQD — discounted subtotal (NOT original price). Use this for all receipt/history displays.
  depositPaid   Int           // IQD — Math.round((totalPrice * 0.2) / 250) * 250
  discountPct   Int?          // snapshot at booking time — null if no discount was active
  paymentMethod PaymentMethod
  paymentStatus PaymentStatus @default(PENDING)
  hasReview     Boolean       @default(false)
  createdAt     DateTime      @default(now())
  services      BookingService[]
}

model BookingService { bookingId String; serviceId String; @@id([bookingId, serviceId]) }

enum BookingStatus  { UPCOMING CONFIRMED COMPLETED CANCELLED NO_SHOW }
enum PaymentMethod  { ZAINCASH FIB PAYTABS }
enum PaymentStatus  { PENDING PAID REFUNDED FAILED }
```

### Snapshot Fields — Why They Exist
`barberName` and `discountPct` on `Booking` are intentional snapshots:
- A barber's display name can be edited or the barber removed from the shop — old receipts must still show who cut the hair.
- A discount can be removed or changed — old receipts must show the actual price the customer paid.
- **Never derive these by joining** `Barber.name` or `ShopDiscount.pct` at query time. Read the snapshot columns.

### Deposit Calculation (authoritative formula)
```typescript
const discountedSubtotal = discountPct
  ? Math.round(subtotal * (1 - discountPct / 100))
  : subtotal;
const deposit = Math.round((discountedSubtotal * 0.2) / 250) * 250;
// Rounds to nearest 250 IQD for clean cash amounts
// Example: subtotal=15000, discount=30% → discounted=10500, deposit=Math.round(10500*0.2/250)*250=2000
```
Backend must use **this exact formula**. The 250 IQD rounding means the deposit is never exactly 20% — this is intentional and the label on the frontend says "Deposit" (not "Deposit (20%)").

### Currency Format Rule
All monetary values stored as integers (IQD, no decimals). Frontend renders via `fmtCurrency(amount, locale)` in `lib/format-currency.ts` — returns `"15,000 IQD"` (en) or `"١٥٬٠٠٠ د.ع."` (ar). API must always return raw integers, never pre-formatted strings.

---

## 6. Checkout / Payments (`/checkout`)

### Frontend Mock State
**NEEDS BACKEND** — `checkout-layout.tsx` `handlePay()` simulates 2.5s delay then shows success. No real gateway call. Appointment stored only in `useAppointmentsStore` (localStorage).

**The checkout page calls:** `/api/payments/initiate` (does not exist yet as a BFF route)

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| POST | `/payments/initiate` | `{ bookingId, method }` | `{ gatewayUrl? }` or `{ reference }` |
| POST | `/payments/callback` | Gateway webhook | 200 OK — verify signature, update BookingPaymentStatus |
| GET | `/payments/:bookingId/status` | Bearer JWT | `{ status: PaymentStatus }` |

**Payment Gateway Notes:**
- **ZainCash:** Iraqi mobile wallet — API call to ZainCash sandbox/prod
- **FIB (Fallah International Bank):** Iraqi bank — FIB API
- **PayTabs Iraq:** Card payments — PayTabs API

---

## 7. Queue (`/queue/[bookingId]`)

### Frontend Mock State
**BFF STUB EXISTS** — `app/api/queue/[bookingId]/route.ts` returns from `queue-mock.ts`. TODO comment: "forward to Express BFF → fetch live queue position from DB."

**Shape the frontend expects (from QueueEntry type):**
```typescript
{
  bookingId: string; position: number; totalInQueue: number;
  estimatedWaitMin: number; status: 'waiting'|'next'|'in_chair'|'completed'|'no_show';
  shopName: string; shopNameAr: string; barberName: string;
  serviceName: string; serviceNameAr: string;
}
```

**Polling:** Every 30s via `setInterval` in `queue-client.tsx`.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/queue/:bookingId` | Bearer JWT (customer) | `QueueEntry` |
| GET | `/shops/:id/queue` | Bearer JWT (owner/barber) | `QueueEntry[]` sorted by position |
| POST | `/shops/:id/queue/walk-in` | Owner/Barber JWT, `{ customerName, serviceIds[], barberId }` | `QueueEntry` |
| PATCH | `/queue/:entryId/start` | Barber JWT | Updated `QueueEntry` (status→in_chair) |
| PATCH | `/queue/:entryId/done` | Barber JWT | Updated `QueueEntry` (status→completed) |
| PATCH | `/queue/:entryId/no-show` | Barber JWT | Updated `QueueEntry` (status→no_show) |
| PATCH | `/queue/:entryId/reorder` | Owner JWT, `{ newPosition }` | Updated list |

### DB Models
```prisma
model QueueEntry {
  id            String      @id @default(cuid())
  shopId        String
  bookingId     String?     // null for walk-ins
  customerName  String
  serviceIds    String[]
  barberId      String?
  position      Int
  status        QueueStatus @default(WAITING)
  estimatedWait Int         @default(0) // minutes
  createdAt     DateTime    @default(now())
}

enum QueueStatus { WAITING IN_CHAIR DONE NO_SHOW }
```

---

## 8. Booking History & Receipt Detail (`/account/bookings`, `/account/bookings/[id]`)

> **Phase 7.12 context:** Frontend now reads from `useAppointmentsStore` (localStorage persisted). When the backend is wired, swap the store reads for BFF calls — the UI shape is locked in below.

### Frontend Mock State
**NEEDS BACKEND** — `useAppointmentsStore` (localStorage) holds appointments added via checkout. `/account/bookings` reads from this store. `/account/bookings/[id]` shows a full receipt detail page. Write-review lives at `/account/bookings/[id]/review`.

**Shape `GET /bookings` must return (list view):**
```typescript
{
  id: string;                    // booking reference shown on receipt
  shop: { id, name, nameAr, image };
  services: { key: string; nameEn: string; nameAr: string; price: number; durationMin: number }[];  // PRICE SNAPSHOT — see rule below
  barberId: string | null;
  barberName: string | null;     // SNAPSHOT — read from Booking.barberName, NOT a join to Barber.name
  slot: string;                  // ISO datetime
  paymentMethod: 'zaincash' | 'fib' | 'paytabs';
  totalPrice: number;            // IQD — discounted subtotal (original price if no discount)
  depositPaid: number;           // IQD — Math.round((totalPrice * 0.2) / 250) * 250
  discountPct: number | null;    // SNAPSHOT — null if no discount was active at booking time
  remainingBalance: number;      // totalPrice - depositPaid (computed on backend, not stored)
  status: 'upcoming' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  hasReview: boolean;
  createdAt: string;
}[]
```

**Shape `GET /bookings/:id` must return (receipt detail):** Same as above — single object.

**Important field notes:**
- `totalPrice` is the **discounted** price the customer agreed to pay — do NOT return the original pre-discount subtotal here.
- `barberName` must come from `Booking.barberName` (the snapshot column), not a join.
- `services[].price` is the per-service price **at booking time** (after discount if applicable) — see BookingService snapshot rule below.
- The frontend derives `remainingBalance = totalPrice - depositPaid` locally. Backend can compute it or return it pre-computed.

### Price Snapshot Rule (CRITICAL)
`BookingService` must store `nameEn`, `nameAr`, and `price` **at the time of booking**, not a foreign key to the current service price. If a shop owner later changes a service price, old receipts must still show what the customer actually paid. See DB model below.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/bookings` | Bearer JWT (customer) | Booking list (shape above), sorted by slot desc |
| GET | `/bookings/:id` | Bearer JWT | Single booking (same shape) |
| PATCH | `/bookings/:id/cancel` | Bearer JWT, `{ reason }` | Updated booking — blocked if slot < 2h away |
| POST | `/reviews` | Bearer JWT, FormData (below) | `{ ok: true }` (201) |
| GET | `/shops/:id/reviews` | `?page&limit&minRating&flagStatus` | Paginated reviews |
| GET | `/barbers/:id/reviews` | `?page&limit` | Barber-filtered reviews |
| POST | `/reviews/:id/flag` | Owner JWT, `{ reason: 'spam'\|'inappropriate'\|'fake' }` | `{ ok: true }` — sets flagStatus→PENDING |
| PATCH | `/reviews/:id/flag` | Admin JWT, `{ action: 'approve'\|'remove', removalReason? }` | `{ ok: true }` — resolves flag |

**Review FormData shape:**
```typescript
{
  bookingId: string;
  rating: 1|2|3|4|5;
  comment: string;  // min 10, max 500 chars
  photos: File[];   // max 4, JPEG/PNG/WebP, max 4MB each
}
```

### Business Rules
- One review per booking: check `Booking.hasReview` before allowing POST. Return `409` if already reviewed.
- After review submit: set `Booking.hasReview = true`.
- Cancel blocked if `slot < now + 2h` — return `422 { error: 'too_late_to_cancel' }`.
- Flag endpoint: only `SHOP_OWNER` of that shop may flag. Return `403` for other roles.
- Approve action: `flagStatus = APPROVED`, review stays visible.
- Remove action: `flagStatus = REMOVED`, `isVisible = false`. Queue notification to shop owner.
- Customer-facing review lists (`GET /shops/:id/reviews`): exclude `isVisible = false`. Dashboard owner view: include PENDING flags.

### Flag Lifecycle
```
Owner flags review (dashboard 6.7.3)
  → POST /reviews/:id/flag { reason }
  → Review.flagStatus = PENDING
  → Frontend shows "Pending review" badge

Admin resolves (admin panel 0.6.1)
  → PATCH /reviews/:id/flag { action: 'approve' }  → flagStatus = APPROVED, badge gone
  → PATCH /reviews/:id/flag { action: 'remove', removalReason }
      → flagStatus = REMOVED, isVisible = false
      → Notification → shop owner: "A flagged review has been removed"
```

### DB Models
```prisma
model Review {
  id            String      @id @default(cuid())
  bookingId     String      @unique
  customerId    String
  shopId        String
  barberId      String?
  rating        Int         // 1-5
  comment       String
  isVisible     Boolean     @default(true)
  flagStatus    FlagStatus?
  flagReason    FlagReason?
  flaggedBy     String?
  flaggedAt     DateTime?
  removalReason String?
  resolvedAt    DateTime?
  createdAt     DateTime    @default(now())
  photos        ReviewPhoto[]
}

model ReviewPhoto { id String @id; reviewId String; url String }

// Price snapshot — stores service state at booking time, not a live FK to Service
model BookingService {
  bookingId   String
  serviceId   String
  nameEn      String   // snapshot
  nameAr      String   // snapshot
  price       Int      // snapshot — IQD at time of booking
  durationMin Int      // snapshot
  @@id([bookingId, serviceId])
}

enum FlagStatus { PENDING APPROVED REMOVED }
enum FlagReason { SPAM INAPPROPRIATE FAKE }
```

---

## 9. Hair Analysis (`/hair-analysis`)

### Frontend Mock State
**BFF STUB EXISTS** — `app/api/hair-analysis/route.ts` validates image, simulates 1.8s delay, returns random mock data. TODO: "replace mock with real ML service call via Express BFF."

**Shape the frontend expects:**
```typescript
{
  hairType: 'straight'|'wavy'|'curly'|'coily';
  conditionScore: number;  // 0-100
  recommendations: string[];  // i18n keys like 'rec1','rec2','rec3'
  suggestedServices: string[];  // service keys like 'svcHaircut','svcBeard','svcScalp'
}
```

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| POST | `/hair-analysis` | Multipart image (JPEG/PNG/WebP, max 5MB) | `{ jobId }` |
| GET | `/hair-analysis/:jobId` | — | `{ status: 'processing'|'done'|'error', result?: AnalysisResult }` |

**Job Processing:** BullMQ + Redis. Heavy ML offloaded to worker process.

---

## 10. Contact Form (`/contact`)

### Frontend Mock State
**BFF STUB EXISTS** — `app/api/contact/route.ts` validates input, returns 200, TODO: "forward to Express BFF → email service."

**Shape the form submits:**
```typescript
{ name: string; email: string; subject: 'support'|'partnership'|'feedback'|'other'; message: string }
```

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| POST | `/contact` | `{ name, email, subject, message }` | `{ ok: true }` |

**Action:** Save to DB + send email notification to admin.

### DB Models
```prisma
model ContactMessage {
  id        String   @id @default(cuid())
  name      String
  email     String
  subject   String
  message   String
  createdAt DateTime @default(now())
}
```

---

## 11. Dashboard (Owner/Barber)

### Frontend Mock State
**STATIC ONLY (currently)** — Dashboard shell exists but all section pages are NOT BUILT yet. When built, they will all need real APIs.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/dashboard/stats` | Owner/Barber JWT | `{ todayBookings, todayRevenue, queueLength, avgWaitMin }` |
| GET | `/dashboard/activity` | Owner JWT | Last 10 events (type, description, timestamp) |
| GET | `/dashboard/analytics` | Owner JWT, `?range=today\|week\|month&start&end` | `{ labels[], revenue[], bookings[] }` — full shop totals |
| GET | `/dashboard/analytics` | Barber JWT, `?range=...` | Same shape, auto-scoped to `barberId` from token — barber sees only their own numbers |
| GET | `/dashboard/analytics/barbers` | Owner JWT | `[{ barberId, name, revenue, bookings, avgRating }]` — per-barber breakdown for owner |
| GET | `/dashboard/analytics/top-services` | Owner or Barber JWT | `[{ serviceKey, bookings, revenue }]` — scoped by role automatically |
| GET | `/dashboard/analytics/peak-hours` | Owner or Barber JWT | `[{ day: 0-6, hour: 0-23, count }]` + `shopHours: ShopHours` — scoped by role automatically |

### Peak Hours Heatmap — Shop Hours Dependency

The heatmap is **fully dynamic** — visible hours derive from the shop's `BusinessHours` config, not a hardcoded range. The API must return both the booking counts AND the shop hours together so the frontend can:
1. Compute the union of all open hours across all days (`deriveVisibleHours()`)
2. Mark cells outside a day's schedule as "closed" (dimmed, no hover)
3. Strikethrough closed day headers (Friday in the mock)

```typescript
// Expected API response shape for peak-hours endpoint
{
  cells: { day: number; hour: number; count: number }[];
  shopHours: {
    [dayIndex: 0..6]: { open: number; close: number } | null  // null = closed
  }
}
```

When backend is wired: replace `MOCK_SHOP_HOURS` in `analytics-constants.ts` with the `shopHours` field from the API response. The `deriveVisibleHours()` utility and heatmap component need no other changes.

### Analytics Role Scoping Rules

| Endpoint | `shop_owner` | `barber` |
|---|---|---|
| `GET /dashboard/analytics` | All bookings for the shop | Only bookings where `barberId = req.user.id` |
| `GET /dashboard/analytics/barbers` | Returns all barbers breakdown | **403 Forbidden** — barbers cannot see peers' revenue |
| `GET /dashboard/analytics/top-services` | Shop-wide service stats | Services this barber performed only |
| `GET /dashboard/analytics/peak-hours` | Shop-wide heatmap | This barber's peak hours only |

### Backend Scoping Implementation

```typescript
// Express middleware pseudocode
const shopId = req.user.shopId;
const isOwner = req.user.role === 'SHOP_OWNER';
const barberId = isOwner ? undefined : req.user.id;

// All analytics queries use this helper:
const where = {
  shopId,
  ...(barberId ? { barberId } : {}),  // barber sees only their rows
};
```

### Frontend Role Branching (dashboard 6.8)

```typescript
// page.tsx reads session role and conditionally renders barber breakdown
const session = useSession();
const isOwner = session.user.role === 'shop_owner';

// RevenueChart — shown to both roles (data differs by API scoping)
// BarberBreakdownTable — shown to owner only (isOwner === true)
```
| GET | `/dashboard/services` | Owner JWT | Full service list with CRUD |
| POST/PATCH/DELETE | `/shops/:id/services/...` | Owner JWT | CRUD |
| GET | `/shops/:id/barbers` | Owner JWT | Staff list |
| POST/PATCH/DELETE | `/shops/:id/barbers/...` | Owner JWT | CRUD |
| PATCH | `/shops/:id/barbers/:barberId/schedule` | Owner JWT | Update weekly availability |
| GET | `/dashboard/reviews` | Owner JWT, `?page&flag` | Paginated reviews |
| POST | `/reviews/:id/flag` | Owner JWT | Flag as spam |

---

### 11a. Service Active/Inactive Toggle — Full Wiring Required

**Current state (frontend stub):** The active/inactive toggle in `/dashboard/services` (6.5.1) only updates local React state. It does NOT persist to any backend, and has NO effect on any other page. The toggle is purely visual — it dims the card.

**What must be wired when building the backend:**

#### Backend endpoint to add
```
PATCH /shops/:shopId/services/:serviceId
Body: { active: boolean }
Auth: Owner JWT + shop ownership check
Action: UPDATE Service SET isActive = active WHERE id = serviceId AND shopId = shopId
```

#### Frontend BFF route to add
```
PATCH /api/services/[id]
Forwards to Express PATCH /shops/:shopId/services/:serviceId
Reads shopId from session (owner's shopId)
```

#### Pages that must filter by isActive = true (customer-facing)

| Page | Component | What to filter |
|---|---|---|
| `/shops/[id]` | `services-section.tsx` | Only show `isActive: true` services |
| `/booking` Step 2 | `select-service-barber-step.tsx` | Only show `isActive: true` services in picker |
| `/services` catalog | `services-catalog-client.tsx` | Only show `isActive: true` services |
| `/barber/[id]` | `barber-services-section.tsx` | Only show barber's services where `isActive: true` |
| Dashboard queue walk-in form | `walk-in-form.tsx` | Service dropdown: only `isActive: true` |

#### Backend enforcement rule
All customer-facing endpoints that return services must include `WHERE isActive = true` in the Prisma query. The dashboard owner endpoints (`GET /dashboard/services`) return ALL services regardless of `isActive` so the owner can see and manage inactive ones.

```prisma
// Customer-facing (always filter)
await prisma.service.findMany({ where: { shopId, isActive: true } })

// Dashboard owner view (no filter)
await prisma.service.findMany({ where: { shopId } })
```

#### Photo gallery (6.5.5 stub note)
The per-service photo gallery (task 6.5.5, built client-side) stores photos in `ServicePhoto[]`. When wiring: `POST /shops/:shopId/services/:serviceId/photos` for upload, `DELETE /photos/:photoId` for delete, `PATCH /shops/:shopId/services/:serviceId/photos/reorder` for order updates (`ServicePhoto.order` column).

---

## 12. Notifications

### Frontend Mock State
**NOT BUILT** — Bell icon exists in dashboard topbar, no functionality.

### Required Endpoints

| Method | Route | Input | Output |
|---|---|---|---|
| GET | `/notifications` | Bearer JWT | `{ notifications[], unreadCount }` |
| PATCH | `/notifications/:id/read` | Bearer JWT | `{ ok: true }` |
| PATCH | `/notifications/read-all` | Bearer JWT | `{ ok: true }` |

### DB Models
```prisma
model Notification {
  id         String           @id @default(cuid())
  userId     String
  type       NotificationType
  message    String
  messageAr  String
  isRead     Boolean          @default(false)
  bookingId  String?
  reviewId   String?
  createdAt  DateTime         @default(now())
}

enum NotificationType { BOOKING_CONFIRMED REMINDER CANCELLATION NEW_REVIEW PAYMENT_RECEIVED SYSTEM_ALERT }
```

---

## 13. Shop Owner Onboarding (5-step wizard)

### Frontend Mock State
**NOT BUILT** — Route `/dashboard/onboarding` does not exist yet.

### Required Endpoints

| Step | Method | Route | Input |
|---|---|---|---|
| 1 Basics | POST | `/onboarding/basics` | `{ nameEn, nameAr, address, phone, city, lat, lng }` |
| 2 Branding | POST | `/onboarding/branding` | Multipart: cover (5MB), logo (2MB) |
| 3 Services | POST | `/onboarding/services` | `{ services: [{nameEn, nameAr, category, price, durationMin}] }` |
| 4 Hours | POST | `/onboarding/hours` | `{ hours: [{dayOfWeek, openTime, closeTime, isClosed}] }` |
| 5 Payment | POST | `/onboarding/payment` | `{ method, credentials }` → activates shop |

---

## 14. Marketplace (Affiliate/Redirect Model)

### Business Model
BarberOS is a **discovery layer**, not a store. Products are curated from external suppliers. Clicking "Shop Now" redirects the barber to the supplier's website. No inventory, no cart, no checkout on BarberOS's side.

**Future — Partnership Phase:** When supplier partnerships are signed, replace static `supplierUrl` with tracked affiliate URLs. Backend generates short redirect links, tracks click-throughs, and receives purchase callbacks to award loyalty points.

### Current State (Phase 6.9)
**STATIC ONLY** — `marketplace-constants.ts` contains 12 hardcoded products with direct `supplierUrl` links. No backend needed yet.

### Required Endpoints (Partnership Phase)

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/marketplace/products` | Barber/Owner JWT | `?category&page&limit` | `{ products[], total }` — pulled from DB, managed by admin |
| GET | `/marketplace/products/:id/redirect` | Barber/Owner JWT | — | `302` redirect to affiliate URL — logs click for analytics |
| POST | `/marketplace/affiliate/callback` | Supplier webhook | `{ orderId, barberId, amount }` | `{ ok: true }` — awards loyalty points |

### DB Models (Partnership Phase)
```prisma
model MarketplaceProduct {
  id          String   @id @default(cuid())
  nameEn      String
  nameAr      String
  brand       String
  category    String
  price       Int      // indicative IQD price
  stock       String   // 'in_stock' | 'low' | 'out'
  descEn      String
  descAr      String
  photoUrl    String
  supplier    String
  supplierUrl String   // direct or affiliate URL
  isActive    Boolean  @default(true)
  clickCount  Int      @default(0)
}

model AffiliateClick {
  id         String   @id @default(cuid())
  productId  String
  userId     String
  clickedAt  DateTime @default(now())
}
```

### Barber Discount (Partnership Phase)
When a partnership is active, the redirect URL includes a barber-specific discount code:
```
https://supplier.com/product?ref=barberos&code=BARBER10
```
Code is generated per-barber and tracked in `AffiliateClick`. Discount % negotiated per supplier contract.

---

## Roles & Authorization Summary

| Role | Can Access |
|---|---|
| CUSTOMER | Book, review, queue tracking, account pages |
| BARBER | Queue controls, own appointments, own profile |
| SHOP_OWNER | Everything BARBER + staff, analytics, settings, onboarding |
| ADMIN | Everything + platform admin |

**Guards:**
- All protected routes: `Authorization: Bearer <accessToken>`
- Role middleware per route group
- Owner scope: `shop.ownerId === req.user.id` check on all shop mutations

---

## File Upload Pattern

- All uploads: Next.js BFF → multipart forward → Express → S3
- Size limits: cover 5MB, logo 2MB, review photos 4MB each, portfolio 4MB each
- Allowed types: JPEG, PNG, WebP
- Returns: S3 public URL stored in DB

---

## 15. Platform Settings (`/admin/settings`) — Maintenance Mode

### Frontend Mock State
**STATIC ONLY (currently)** — All 4 settings cards (global deposit %, commission %, maintenance mode, SMS config) store state in React only. Nothing persists. Maintenance mode toggle does NOT block any real users.

### What Must Be Wired

#### Maintenance Mode Flow
1. Admin enables toggle → `POST /admin/platform-config` `{ maintenanceMode: true }`
2. Express saves flag to `PlatformConfig` table
3. Next.js `middleware.ts` calls `GET /admin/platform-config` on every request (or reads from Redis cache with 30s TTL)
4. If `maintenanceMode: true` and `req.user.role !== 'admin'` → redirect to `/maintenance`
5. Admin role bypasses check entirely (reads from JWT `role` claim)

#### Global Deposit % + Commission %
- Saved to `PlatformConfig.defaultDepositPercent` and `PlatformConfig.commissionPercent`
- When a new shop is created (onboarding step 5), it inherits `PlatformConfig.defaultDepositPercent` as its starting deposit setting
- Individual shops can override — their `Shop.depositPercent` takes precedence if set

#### SMS Config
- API key and sender ID saved to `PlatformConfig.smsProvider`, `.smsApiKey`, `.smsSenderId`
- Key is encrypted at rest (AES-256 via `crypto` Node module) — never returned in GET response (masked `****`)
- Test SMS endpoint: `POST /admin/platform-config/test-sms` `{ phone }` — sends a real test message via provider

### Required Endpoints

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/admin/platform-config` | Admin JWT | — | `{ defaultDepositPercent, commissionPercent, maintenanceMode, smsProvider, smsSenderId, smsApiKeyMasked }` |
| PATCH | `/admin/platform-config` | Admin JWT | `{ defaultDepositPercent?, commissionPercent?, maintenanceMode?, smsProvider?, smsApiKey?, smsSenderId? }` | `{ ok: true }` |
| POST | `/admin/platform-config/test-sms` | Admin JWT | `{ phone }` | `{ ok: true }` or `{ error: string }` |

### DB Model
```prisma
model PlatformConfig {
  id                   String   @id @default("singleton")
  maintenanceMode      Boolean  @default(false)
  defaultDepositPercent Int     @default(20)  // 1–100
  commissionPercent    Float    @default(10)  // 1–50
  smsProvider          String   @default("unifonic")  // 'unifonic' | 'twilio'
  smsApiKeyEncrypted   String?  // AES-256 encrypted, never exposed in GET
  smsSenderId          String?
  updatedAt            DateTime @updatedAt
}
```

### Middleware Integration (Next.js)
```typescript
// middleware.ts — add after auth check
const config = await fetch(`${process.env.API_URL}/admin/platform-config`).then(r => r.json());
if (config.maintenanceMode && session?.user.role !== 'admin') {
  return NextResponse.redirect(new URL('/maintenance', req.url));
}
```
**Performance note:** Cache the platform config in Redis with a 30s TTL to avoid hitting the DB on every request. Invalidate cache on PATCH.

---

## 16. Subscription Plans & Feature Gating

### Business Model Decision
Three tiers: **Free** (queue only), **Starter** (10,000 IQD/month, ~$7.70), **Pro** (25,000 IQD/month, ~$19, all features).

### DB Model
```prisma
enum ShopPlan { FREE STARTER PRO }

// Add to Shop model:
model Shop {
  // ... existing fields
  plan          ShopPlan  @default(FREE)
  planUpdatedAt DateTime?
  planExpiresAt DateTime? // null = monthly rolling, set for annual
}
```

### Feature Gate Rules

| Feature | FREE | STARTER | PRO |
|---|---|---|---|
| Walk-in queue management | ✅ | ✅ | ✅ |
| Shop profile page | ✅ | ✅ | ✅ |
| WhatsApp queue link share | ✅ | ✅ | ✅ |
| Max barber accounts | 1 | 2 | Unlimited |
| Pre-booking (slot selection) | ❌ | ✅ | ✅ |
| Deposit collection (ZainCash/FIB) | ❌ | ✅ | ✅ |
| Basic booking history | ❌ | ✅ | ✅ |
| Analytics dashboard | ❌ | ❌ | ✅ |
| Staff scheduling management | ❌ | ❌ | ✅ |
| Review management + flag | ❌ | ❌ | ✅ |
| Customer booking reminders | ❌ | ❌ | ✅ |
| Multi-branch support | ❌ | ❌ | ✅ |

### Walk-In Queue Mode (`bookingMode`)

Add `bookingMode` field to `Shop` so shops can operate queue-only (the free entry point):

```prisma
enum BookingMode { QUEUE_ONLY BOOKING_ONLY BOTH }

// Add to Shop model:
bookingMode BookingMode @default(QUEUE_ONLY) // Free shops default to queue-only
```

**Guard rule:** If `shop.bookingMode === QUEUE_ONLY` and a customer hits the booking wizard for this shop, return `403 { error: 'booking_disabled', mode: 'queue_only' }`. Frontend redirects to the queue join page instead.

### Required Endpoints

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/shops/:id/plan` | Owner JWT | — | `{ plan, planExpiresAt, features: FeatureSet }` |
| PATCH | `/shops/:id/plan` | Admin JWT (manual for now) | `{ plan: ShopPlan }` | `{ ok: true }` |
| PATCH | `/shops/:id/booking-mode` | Owner JWT | `{ mode: BookingMode }` | `{ ok: true }` |

**Frontend BFF routes to add:**
- `GET /api/shop/plan` → `/shops/:shopId/plan` (reads shopId from session)
- `PATCH /api/shop/booking-mode` → `/shops/:shopId/booking-mode`

### Plan Enforcement Middleware (Express)

```typescript
// Reusable middleware factory
function requirePlan(minPlan: ShopPlan) {
  return async (req, res, next) => {
    const shop = await prisma.shop.findUnique({ where: { id: req.user.shopId } });
    const planRank = { FREE: 0, STARTER: 1, PRO: 2 };
    if (planRank[shop.plan] < planRank[minPlan]) {
      return res.status(403).json({ error: 'plan_required', requiredPlan: minPlan });
    }
    next();
  };
}

// Usage on routes:
router.post('/bookings', requirePlan('STARTER'), createBooking);
router.get('/dashboard/analytics', requirePlan('PRO'), getAnalytics);
router.get('/dashboard/reviews', requirePlan('PRO'), getReviews);
```

### Frontend Plan Gate Utility

```typescript
// lib/plan-gate.ts
export type ShopPlan = 'free' | 'starter' | 'pro';

const PLAN_RANK: Record<ShopPlan, number> = { free: 0, starter: 1, pro: 2 };

export function canAccess(shopPlan: ShopPlan, requiredPlan: ShopPlan): boolean {
  return PLAN_RANK[shopPlan] >= PLAN_RANK[requiredPlan];
}
```

When the API returns `403 { error: 'plan_required', requiredPlan }`, the frontend catches it and shows the `<UpgradePromptModal requiredPlan={requiredPlan} />`.

### Optional Deposit Per Shop

`Shop.depositRequired` (boolean, default `false`) controls whether checkout enforces a deposit.
- FREE tier: always `false` (deposits disabled — requires STARTER+)
- STARTER / PRO: owner sets via `/dashboard/settings` → 6.11.1 toggle

```prisma
// Add to Shop model:
depositRequired  Boolean @default(false)
depositPercent   Int     @default(20)  // 1–100, only relevant if depositRequired = true
```

Backend booking creation checks: `if (shop.depositRequired && shop.plan !== 'FREE') → enforce deposit calculation`.

---

## 17. Empty Slot Discount System (Phase 10)

### Current State
**STATIC ONLY** — Discount data is hardcoded in `shop-detail.constants.ts` and `shops.constants.ts`. The `DiscountRule` type is a frontend-only construct. All discount math runs client-side.

### Frontend Shape (what every UI component expects from the shop object)
```typescript
type DiscountRule = {
  pct: number;         // e.g. 30 = 30% off
  maxUsers: number;    // max bookings eligible for this discount
  slotsClaimed: number; // how many have already claimed it
  expiresAt: string;   // ISO datetime
};

// Attached to BookingShop in Zustand store and DiscoveryShop in constants
discount?: DiscountRule;
```

### Where Discount Is Applied (frontend — all currently static)
The discount `pct` flows through every price-bearing surface:

| Surface | File | How applied |
|---|---|---|
| Shop card badge | `discovery-shop-card.tsx` | `<DiscountBadge pct={discount.pct} />` |
| Shop header badge | `shop-header.tsx` | Same badge, `w-fit` wrapper |
| Service cards (shop detail) | `service-card.tsx` | Line-through original + discounted price |
| Sticky booking bar | `sticky-booking-bar.tsx` | Discounted total, line-through original |
| Booking step 2 service picker | `service-select-card.tsx` | Line-through + discounted price |
| Booking step 4 order summary | `order-summary-card.tsx` | Per-service line-through + discount line item |
| Checkout order panel | `order-summary-panel.tsx` | Same as above |
| Checkout pay button | `checkout-layout.tsx` | Deposit calculated on discounted subtotal |
| Success/receipt page | `checkout-success.tsx` | Full breakdown with discount line |

### Deposit Calculation with Discount
```typescript
// All surfaces use this formula — must be identical on backend
const discountedSubtotal = Math.round(subtotal * (1 - discountPct / 100));
const deposit = Math.round((discountedSubtotal * 0.2) / 250) * 250;
// round deposit to nearest 250 IQD
```

### Required Backend Endpoints

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/shops/:id/discount` | Public | — | `DiscountRule \| null` |
| POST | `/shops/:id/discount` | Owner JWT | `{ pct, maxUsers, expiresAt }` | Created `DiscountRule` |
| DELETE | `/shops/:id/discount` | Owner JWT | — | `{ ok: true }` — removes active discount |
| GET | `/shops` | Public | — | Include `discount` field on each shop (see §2) |
| GET | `/shops/:id` | Public | — | Include `discount` field on shop detail |

### Booking Creation — Discount Claim Logic
When `POST /bookings` is called:
1. Re-fetch `Shop.discount` inside the transaction — **never trust the client-sent pct**.
2. If `discount` exists and `slotsClaimed < maxUsers` and `now < expiresAt`:
   - Increment `ShopDiscount.slotsClaimed` atomically.
   - Store `discountPct` snapshot on the `Booking` record.
   - Use discounted price for `totalPrice` and `depositAmount` calculation.
3. If `slotsClaimed >= maxUsers` — discount expired by volume, proceed at full price.
4. Race condition guard: use `UPDATE ... WHERE slotsClaimed < maxUsers` pattern (optimistic lock).

### DB Models
```prisma
model ShopDiscount {
  id           String   @id @default(cuid())
  shopId       String   @unique   // one active discount per shop
  pct          Int                // 1–100
  maxUsers     Int                // max bookings at this price
  slotsClaimed Int      @default(0)
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  shop         Shop     @relation(fields: [shopId], references: [id])
}

// Add to Booking model:
// discountPct  Int?   // snapshot of pct at booking time — null if no discount applied
```

### CRITICAL: Price Snapshot Rule (extends §9 Booking History)
`Booking.discountPct` must be snapshotted at booking time — same as service prices. If the shop later removes the discount, old bookings must still show what the customer actually paid.

### Scarcity Banner Logic
Frontend shows amber `AlertCircle` banner in `order-summary-card.tsx` when `slotsLeft <= 5`.
- `slotsLeft = discount.maxUsers - discount.slotsClaimed`
- Backend must return live `slotsClaimed` on `GET /shops/:id` — not a cached value.
- Frontend i18n key: `Booking.slotsLeft` with `{ count }` interpolation.

### Dashboard — Discount Management (Owner)
When Phase 11+ builds the dashboard discount UI, it will call:
- `GET /shops/:id/discount` to show current active discount.
- `POST /shops/:id/discount` to create a new time-limited flash discount.
- `DELETE /shops/:id/discount` to cancel it early.
Owner should see live `slotsClaimed / maxUsers` progress so they can gauge uptake.

---

## 18. Mock Data Files → API Endpoint Contracts

These files were split from `account-constants.ts` during Phase 10 refactor. Each maps directly to a real API endpoint the backend must implement.

### `components/account/bookings-mock.ts`
```typescript
// Types exported:
type BookingStatus = 'upcoming' | 'confirmed' | 'past' | 'cancelled';
type AccountBooking = { id, shopName, shopImage, services, barberName, slot, status, totalPrice, depositPaid };
const ACCOUNT_BOOKINGS: AccountBooking[]; // 3 mock entries
```
**Maps to:** `GET /bookings` — the customer's personal booking history. See §8 for full shape contract.

### `components/account/notifications-mock.ts`
```typescript
// Customer notifications
type NotificationType = 'booking_confirmed' | 'reminder' | 'cancellation' | 'system';
type AccountNotification = { id, type, title, titleAr, message, messageAr, time, isRead, bookingId? };
const ACCOUNT_NOTIFICATIONS: AccountNotification[];

// Dashboard (owner/barber) notifications — same shape, different context
type DashboardNotificationType = 'new_booking' | 'cancellation' | 'review' | 'payment' | 'system';
type DashboardNotification = { id, type, title, titleAr, message, messageAr, time, isRead };
const DASHBOARD_NOTIFICATIONS: DashboardNotification[];
```
**Maps to:** `GET /notifications` — see §12. The backend's single `Notification` model serves both customer and dashboard contexts; `type` enum distinguishes them. The frontend uses `ACCOUNT_NOTIFICATIONS` for `/account` pages and `DASHBOARD_NOTIFICATIONS` for `/dashboard` pages — both hit the same endpoint, filtered by the JWT role.

### `components/account/saved-shops-mock.ts`
```typescript
type SavedShop = { id, name, nameAr, image, neighborhood, neighborhoodAr, rating };
const SAVED_SHOPS: SavedShop[];
```
**Maps to:** `GET /account/saved-shops` (NOT YET IN BLUEPRINT — add this):

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/account/saved-shops` | Customer JWT | — | `SavedShop[]` |
| POST | `/account/saved-shops/:shopId` | Customer JWT | — | `{ ok: true }` — saves shop |
| DELETE | `/account/saved-shops/:shopId` | Customer JWT | — | `{ ok: true }` — removes |

```prisma
model SavedShop {
  userId    String
  shopId    String
  savedAt   DateTime @default(now())
  @@id([userId, shopId])
}
```

---

## §19 Loyalty System — Security-Critical Backend Contract

### Why the frontend implementation is insecure

Phase 11 implemented the loyalty system entirely in Zustand (`lib/loyalty-store.ts`) persisted to localStorage. **This means any JS-literate user can set their points to any value by editing localStorage.** This is intentional for the UI-first build phase — the frontend is display-only until backend is wired.

### What the backend must enforce

**Rule: the frontend NEVER writes points. It only reads what the server returns.**

#### Points earning — server-side only
- `earnPoints()` call in `checkout-layout.tsx` must be REMOVED when backend is live
- The server credits points after a booking is confirmed and deposit payment is verified
- Formula (authoritative): `Math.floor(totalPrice / 1000)` — 1 pt per 1,000 IQD

#### Reward redemption — server-validated
When a booking is submitted with a staged reward, the backend must:
1. Verify the user's actual points balance in DB ≥ `reward.pointsCost`
2. Apply the `reward.discountIQD` deduction to `totalPrice` server-side
3. Deduct points in the same DB transaction as the booking creation (atomic)
4. Return `403` if points are insufficient — never trust the client's claimed balance

#### Required Endpoints

| Method | Route | Auth | Input | Output |
|---|---|---|---|---|
| GET | `/user/loyalty` | Customer JWT | — | `{ points: number, tier: 'bronze'\|'silver'\|'gold', pendingReward: RewardId \| null }` |
| POST | `/user/loyalty/earn` | Internal only (called by booking service, not client) | `{ bookingId }` | `{ points: number }` |
| POST | `/user/loyalty/redeem` | Customer JWT | `{ rewardId: string, bookingId: string }` | `{ ok: true, newBalance: number }` or `403` |

#### Prisma Model

```prisma
model LoyaltyAccount {
  userId    String   @id
  points    Int      @default(0)
  tier      Tier     @default(BRONZE)
  updatedAt DateTime @updatedAt
}

model LoyaltyTransaction {
  id        String          @id @default(cuid())
  userId    String
  type      TransactionType // EARN | REDEEM
  points    Int             // positive = earn, negative = redeem
  bookingId String?
  rewardId  String?
  createdAt DateTime        @default(now())
}

enum Tier { BRONZE SILVER GOLD }
enum TransactionType { EARN REDEEM }
```

#### Tier thresholds (matches `LOYALTY_TIERS` in `lib/loyalty-store.ts`)
- Bronze: 0–99 pts
- Silver: 100–499 pts
- Gold: 500+ pts → also auto-grants VIP status (see §21)

#### Frontend migration plan (when backend is ready)
1. Replace `useLoyaltyStore` reads with `useQuery(['loyalty'], () => api.get('/user/loyalty'))`
2. Remove `earnPoints()` call from `checkout-layout.tsx`
3. Pass `rewardId` to the booking POST body instead of computing discount client-side
4. Keep Zustand store as optimistic UI cache only — invalidate after booking completes

---

## §20 Anti No-Show / Reliability System (Phase 12)

### Frontend State
`lib/reliability-store.ts` — Zustand persist store in localStorage. Same security concern as loyalty: any user can edit their score via DevTools.

### Score Rules (authoritative)
| Event | Adjustment |
|---|---|
| No-show | −20 |
| Late cancel (< 2h before) | −10 |
| Completion (queue marked done) | +15 |
| On-time checkout (paid deposit) | +20 |

Score is clamped: `min 0, max 100`. Starting score: 100.

### Deposit Rate (enforced server-side on booking create)
| Score | Deposit Rate |
|---|---|
| < 40 | 50% |
| 40–59 | 30% |
| 60–100 | 20% |

**Rule:** deposit rate must be calculated server-side from the DB score — never trust a client-sent rate.

### Block Rules
- `score === 0` OR `noShowCount >= 3` → booking creation returns `403 BOOKING_BLOCKED`
- Owner unblock: resets `score = 60`, `noShowCount = 0` (one tier above the 50% threshold)
- Admin can also unblock from `/admin/users`

### Required Endpoints

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/user/reliability` | Customer JWT | `{ score, noShowCount, depositRate, isBlocked }` |
| POST | `/bookings/:id/no-show` | Barber/Owner JWT | Deducts score, increments noShowCount, triggers penalty logic |
| POST | `/bookings/:id/late-cancel` | Customer JWT | Deducts score if cancel < 2h before slot |
| POST | `/admin/users/:id/unblock` | Admin/Owner JWT | Resets score=60, noShowCount=0 |

### Prisma Model

```prisma
model ReliabilityRecord {
  userId      String   @id
  score       Int      @default(100)
  noShowCount Int      @default(0)
  updatedAt   DateTime @updatedAt
}
```

### Frontend Migration Plan
1. Replace `useReliabilityStore` reads with `useQuery(['reliability'], () => api.get('/user/reliability'))`
2. Remove all `penalize()` / `reward()` calls from `use-queue.ts` and `checkout-layout.tsx` — those become server events
3. `getDepositRate()` result comes from the API response, not computed client-side
4. `isBlocked` check in `BookingWizard` becomes a server-driven flag from the API

---

## §21 VIP Customers (Phase 13)

### Frontend State
`isVip` field in `lib/loyalty-store.ts`. Derived client-side: `points >= 500 || manualVip`. Not stored separately in the DB — it's computed from `LoyaltyAccount.points`.

### VIP Rules
- Auto-granted: `LoyaltyAccount.points >= 500` (Gold tier)
- Manual grant: owner or admin can set `User.isVip = true` regardless of points
- Once granted by manual flag, permanent until manually revoked

### VIP Effects (all enforced server-side)
| Feature | Backend Behavior |
|---|---|
| Priority booking window | `GET /shops/:id/slots?date=X` checks JWT. Non-VIP: only dates within 3 days from today are returned. VIP: dates within 7 days. Days 4–7 ahead are VIP-only territory — calendar grays them out with a crown icon for non-VIP. |
| VIP queue lane | `GET /queue` returns entries sorted: VIP walk-ins first if `Shop.vipLaneEnabled = true` |
| Crown badge visible to barbers | Booking and queue entry payloads include `customer.isVip: boolean` |

### Required Endpoints

| Method | Route | Auth | Notes |
|---|---|---|---|
| GET | `/user/vip` | Customer JWT | `{ isVip, grantedAt, grantedBy: 'auto'\|'owner'\|'admin' }` |
| POST | `/admin/users/:id/vip` | Admin/Owner JWT | `{ isVip: boolean }` — manual grant/revoke |

### Prisma Model Changes

```prisma
// Add to User model:
isVip       Boolean  @default(false)
vipGrantedAt DateTime?
vipGrantedBy String?  // 'auto' | 'owner' | 'admin'

// Add to Shop model:
vipLaneEnabled Boolean @default(false)
```

### Frontend Migration Plan
1. Replace `useLoyaltyStore(s => s.points >= GOLD_THRESHOLD || s.isVip)` with `useQuery(['vip'], () => api.get('/user/vip'))`
2. `VipLaneCard` toggle in dashboard settings calls `PATCH /shops/:id` with `{ vipLaneEnabled }` instead of local state
3. `TimeSlotGrid` receives `vipPrioritySlots` from slot API response to know which slots get the crown badge

---

## §22 PWA & Offline Mode (Phase 14)

### Current State
**STATIC / CLIENT-SIDE ONLY** — PWA features are fully implemented on the frontend. No backend changes required for the SW or manifest. The only backend concern is the background sync queue.

### What Is Already Built (Frontend)
- `next-pwa` wraps `next.config.ts` — generates SW in prod build only
- `public/manifest.json` — name, theme `#22c55e`, display standalone, 2 shortcuts (Book Now, My Bookings)
- `app/[locale]/offline/page.tsx` — shown when SW catches a navigation offline
- `lib/offline-cache.ts` — saves/reads last known bookings list to localStorage key `barberos-offline-bookings`
- `lib/sync-queue.ts` — queues offline actions (currently only `cancel_booking`) to localStorage key `barberos-sync-queue`
- `hooks/use-background-sync.ts` — listens for `window online` event, replays queue, calls `queryClient.invalidateQueries()`
- `components/account/offline-bookings-banner.tsx` — amber banner shown in `/account/bookings` when offline with a stale cache timestamp
- `components/account/sync-provider.tsx` — thin wrapper in `/account/layout.tsx` that mounts the background sync hook

### Backend Changes Required When Wiring

#### Background sync replay
`use-background-sync.ts` currently calls `cancelAppointment()` on the local Zustand store. When the real API is live, the `handleOnline` function must instead call the real endpoint for each queued action:

```typescript
// Current (localStorage-only):
cancelAppointment(action.bookingId);

// Must become (real API):
await api.patch(`/bookings/${action.bookingId}/cancel`, { reason: 'user_offline_cancel' });
```

The queue format (`lib/sync-queue.ts`):
```typescript
type SyncAction = {
  id: string;
  type: 'cancel_booking';
  bookingId: string;
  queuedAt: string; // ISO
};
```

#### Offline cache becomes obsolete
Once TanStack Query is wired, it handles its own `staleTime` / `gcTime` caching. The `lib/offline-cache.ts` manual localStorage cache can be removed. The `OfflineBookingsBanner` can then show TanStack Query's `dataUpdatedAt` timestamp instead.

### No New DB Models or Endpoints
Phase 14 introduces no new backend models. The only wiring is:
1. Replace Zustand store calls in background sync with real API calls (same endpoints as §8)
2. Add `reason: 'user_offline_cancel'` to cancel payloads so analytics can distinguish offline-queued cancels

---

## §23 Shop Load / Heatmap (Phase 15)

### Current State
**STATIC ONLY** — `load` field is hardcoded on each shop in `shops.constants.ts`. The values (`low` | `medium` | `high`) are mock data. No real queue data feeds them.

### What Was Built (Frontend)
- `DiscoveryShop.load: 'low' | 'medium' | 'high'` — added to type and all 9 mock shops
- `LOAD_COLORS` + `LOAD_BG` constants — green / amber / red palette
- Map pins use colored SVGs via `makePinIcon(load)` — pre-built `PIN_ICONS` + `PIN_ICONS_DIM` records
- Map legend is interactive — clicking a load dot dims pins of other load types
- Shop cards show a load badge (inline pill) below the neighborhood line
- Availability filter dropdown in `search-filter-bar.tsx` passes `?load=` to the filter function (client-side only for now)

### How `load` Must Be Computed on the Backend

`load` is **not stored** — it is computed at query time from the live queue:

```typescript
// Pseudocode — computed per shop when GET /shops is called
const queueLength = await prisma.queueEntry.count({
  where: { shopId, status: { in: ['WAITING', 'IN_CHAIR'] } }
});

const capacity = shop.maxConcurrentBarbers ?? shop.barbers.length ?? 1;
const ratio = queueLength / capacity;

const load: ShopLoad =
  ratio < 0.5  ? 'low'    :  // < 50% barbers occupied
  ratio < 1.0  ? 'medium' :  // 50–99% occupied
                 'high';      // 100%+ (queue forming)
```

**Rule:** `load` must always be computed fresh — never cached or stored. It changes as the queue evolves. Do not add a `load` column to the `Shop` table.

### Filter Query Param

`GET /shops?load=low` must apply a `HAVING` equivalent — since `load` is computed, it cannot be a simple `WHERE`. Options:
1. **Compute in-memory** (acceptable for < 1,000 shops): fetch all shops with their queue counts, derive `load`, then filter by the requested value before responding.
2. **Subquery** (scalable): `WHERE (SELECT COUNT(*) FROM QueueEntry WHERE shopId = Shop.id AND status IN ('WAITING', 'IN_CHAIR')) / COALESCE(barberCount, 1) < 0.5` — adapt threshold per load tier.

Recommended: option 1 until shop count exceeds ~500. Use Redis to cache the per-shop queue count with a 60s TTL.

### DB Changes Required
None — `load` is derived from existing `QueueEntry` records (see §7). No new columns.

### Frontend Migration Plan
1. Remove `load` field from `shops.constants.ts` mock data (it will come from the API)
2. `GET /shops` response already includes `load` per shop — `DiscoveryShop` type stays identical
3. The `?load=` filter param on `GET /shops` replaces the client-side `if (load && shop.load !== load)` filter in `shops-discovery-client.tsx`
4. Map pins, legend, and shop cards need zero changes — they already read from the `load` field

---

## What Is STATIC ONLY (No Backend Ever Needed)

| Feature | Why static |
|---|---|
| Landing page | Marketing content, all i18n strings |
| About page | Static text, no user data |
| 3D model viewers | GLB files in `/public/3d-models/` |
| Testimonials | Hardcoded mock — replace with real reviews when ready |
| Partner logos | Static branding |
| Footer | Static links |
| Auth logout | Just clears cookies, no backend call |
| Service catalog descriptions | Static i18n strings (ServiceDetails namespace) |
