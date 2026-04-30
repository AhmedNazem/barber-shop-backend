# BarberOS Server — Backend Build Tracker

---

## How to Use This File

1. Find the first phase that is **🔄 In Progress** or **⏳ Pending**
2. Read the corresponding section in `BLUEPRINT.md` before writing any code
3. Check off tasks as you complete them — one commit per checkbox
4. **Write unit tests for every task before committing.** No commit is allowed without passing tests for that task.
5. **Run `npm test` and confirm all tests pass before every `git commit` and `git push`.**
6. Never start a new phase until the previous one passes its full test suite

---

## Testing Rule (Non-Negotiable)

Every checkbox in this file follows this flow:

```
Code → Write test → `npm test` passes → `git commit` → move to next task
```

- Tests live in `tests/` mirroring `src/` structure (e.g., `src/services/otp.service.ts` → `tests/services/otp.service.test.ts`)
- Use **Vitest + Supertest** for all tests
- Minimum coverage per task: happy path + at least one failure/edge case
- Integration tests that hit the DB use a separate test database (`DATABASE_URL_TEST` env var)
- No mocking Prisma unless explicitly noted — use real DB transactions that roll back after each test

---

## Status Overview

| Phase | Name                                | Status      |
| ----- | ----------------------------------- | ----------- |
| S0.5  | Blueprint Gaps & Pre-Build Fixes    | ⏳ Pending  |
| S1    | Project Scaffold                    | ✅ Complete |
| S2    | Auth — OTP + JWT + Invites          | ✅ Complete |
| S3    | Shops & Discovery                   | ✅ Complete |
| S4    | Shop Detail + Barbers + Services    | ⏳ Pending  |
| S5    | Booking Wizard + Availability       | ⏳ Pending  |
| S6    | Checkout + Payments                 | ⏳ Pending  |
| S7    | Queue Management                    | ⏳ Pending  |
| S8    | Booking History + Reviews           | ⏳ Pending  |
| S9    | Dashboard Analytics                 | ⏳ Pending  |
| S10   | Notifications                       | ⏳ Pending  |
| S11   | Onboarding Wizard                   | ⏳ Pending  |
| S12   | Platform Settings + Admin           | ⏳ Pending  |
| S13   | Subscription Plans + Feature Gating | ⏳ Pending  |
| S14   | Loyalty + Reliability + VIP         | ⏳ Pending  |
| S15   | Discount System                     | ⏳ Pending  |
| S16   | Hair Analysis (BullMQ Job)          | ⏳ Pending  |
| S17   | Contact Form + Saved Shops          | ⏳ Pending  |
| S18   | Testing & Hardening                 | ⏳ Last     |

---

## Build Order Rationale

Each phase unblocks the next. S1–S3 must be done before any frontend wiring can begin. S6 (payments) requires S5 (booking). S14 (loyalty/VIP) requires S6 (booking creation is the earn trigger).

---

## Phase S0.5 — Blueprint Gaps & Pre-Build Fixes ⏳

> These gaps were found during a senior-DB audit of BLUEPRINT.md and AGENTS.md. Resolve each one before entering the phase it blocks. The first 5 are schema/logic decisions that affect migrations — agree on the answer, update BLUEPRINT.md, then proceed.

### CRITICAL BLOCKERS (must fix before the phase they block)

- [ ] **S0.5-A** `QueueStatus` enum vs frontend contract mismatch — **blocks S7**
  - DB enum: `WAITING | IN_CHAIR | DONE | NO_SHOW`
  - Frontend contract (AGENTS.md): `'waiting' | 'next' | 'in_chair' | 'completed' | 'no_show'`
  - Decision needed: (1) `DONE` must map to `'completed'` in all API responses (never expose the raw enum string). (2) `'next'` is a **derived** state — position=1 in the WAITING list — not stored in the DB. The queue service must compute it: if `entry.position === 1 && entry.status === 'WAITING'` → return `status: 'next'`. Document this in BLUEPRINT.md §7.
  - Action: update BLUEPRINT.md §7 DB model note + add `'next'` derivation rule. Update `QueueEntry` API response mapper in the queue service when building S7.

- [ ] **S0.5-B** Missing `Reward` model — loyalty redemption impossible — **blocks S14**
  - `POST /user/loyalty/redeem` takes `{ rewardId }` but no `Reward` table is defined anywhere.
  - Decision needed: define the Reward model. Suggested:
    ```prisma
    model LoyaltyReward {
      id          String   @id @default(cuid())
      nameEn      String
      nameAr      String
      pointsCost  Int
      discountIQD Int
      isActive    Boolean  @default(true)
      createdAt   DateTime @default(now())
    }
    ```
  - Action: add model to `schema.prisma`, run migration, add to BLUEPRINT.md §19, add `GET /loyalty/rewards` endpoint to S14.

- [x] **S0.5-C** `neighborhood`/`neighborhoodAr` missing from Shop model — **blocks S3 migration**
  - Frontend DiscoveryShop expects `{ neighborhood: string; neighborhoodAr: string; }` on every shop card and map pin.
  - DB model has `address` and `city` only — neighborhood is missing entirely.
  - Action: add `neighborhood String` and `neighborhoodAr String` to `Shop` in `schema.prisma`. Run migration before S3. Update BLUEPRINT.md §2 DB model.

- [ ] **S0.5-D** Suspension logic references `status = PENDING` which doesn't exist — **blocks S11**
  - BLUEPRINT §1 step 3: "Pending bookings (`status = PENDING`) — set `status = CANCELLED`"
  - `BookingStatus` enum: `UPCOMING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW` — no `PENDING`.
  - The initial booking status is `UPCOMING`. Suspension should cancel `UPCOMING` bookings, not `PENDING` ones.
  - Action: fix BLUEPRINT.md §1 suspension transaction step 3 to say `status = UPCOMING` instead of `PENDING`.

- [x] **S0.5-E** SERVER_TODO_LIST S14 tasks use old HairProfile field names — **blocks S14**
  - S14.11 says "texture, concerns, goals" and S14.12 Zod says "texture, concerns[], goals[]"
  - Actual schema (fixed in last session): `dryness Int, damage Int, scalpCondition String, lastTreatmentDate String?, cutFrequencyWeeks Int`
  - Action: update S14.11 and S14.12 task descriptions below to use the correct field names. ✅ Done.

### IMPORTANT INCONSISTENCIES (fix when entering the relevant phase)

- [x] **S0.5-F** `/auth/me` missing `plan` and `isVip` in BLUEPRINT §1 — **fix before S2.7**
  - BLUEPRINT §1 shows: `{ id, phone, name, role, shopStatus? }`
  - Correct shape (from AGENTS.md frontend contract): `{ id, phone, name, role, shopId?, shopStatus?, plan?, isVip? }`
  - Missing `plan` and `isVip` breaks Next.js plan gates and VIP features silently.
  - Action: update BLUEPRINT.md §1 `/auth/me` output column before implementing S2.7.

- [ ] **S0.5-G** Contact form subject values wrong in BLUEPRINT §10 — **fix before S17.1**
  - BLUEPRINT §10: `'support' | 'partnership' | 'feedback' | 'other'`
  - Correct (from actual frontend): `'general' | 'booking' | 'partnership' | 'technical' | 'complaint'`
  - Action: update BLUEPRINT.md §10 shape. Zod schema in S17.1 must use the correct list.

- [ ] **S0.5-H** Onboarding hours format wrong in BLUEPRINT §13 — **fix before S11.4**
  - BLUEPRINT §13 step 4 says: `{ hours: [{dayOfWeek: Int, openTime, closeTime, isClosed}] }`
  - Actual frontend sends: `{ mon: { closed, open, close }, tue: {...}, ... }` (3-letter day keys)
  - Backend must map `mon→1, tue→2, wed→3, thu→4, fri→5, sat→6, sun→0` when writing `BusinessHours`.
  - Action: update BLUEPRINT.md §13 step 4. The mapping logic goes in the S11.4 service.

- [ ] **S0.5-I** `BookingService` snapshot fields missing from BLUEPRINT §5 — **fix before S5.3**
  - BLUEPRINT §5 DB model shows only `{ bookingId, serviceId }` — no snapshot columns.
  - BLUEPRINT §8 (correct) shows: `nameEn, nameAr, price, durationMin` snapshot columns.
  - A developer reading only §5 will create the wrong table and miss the snapshot requirement.
  - Action: update BLUEPRINT.md §5 BookingService model to match §8.

### NOTABLE GAPS (decision required before the phase)

- [x] **S0.5-J** `isOpen` computation not specified — **decide before S3**
  - Every shop in `GET /shops` needs `isOpen: boolean`.
  - Requires: check today's `BusinessHours` for day-of-week, compare server time (Iraq = GMT+3) against `openTime`/`closeTime`.
  - Decision: server always computes in GMT+3 (`Asia/Baghdad` timezone). Helper: `isShopOpen(hours[], now)`.
  - Action: document in BLUEPRINT.md §2. Build helper in `src/lib/shop-hours.ts` during S3.

- [x] **S0.5-K** `avgRating`/`reviewCount` — computation strategy not specified — **decide before S3**
  - `GET /shops` returns `rating` and `reviewCount` per shop but no column stores these.
  - Decision: compute live with Prisma `_avg` + `_count` on Review (acceptable until ~5k reviews per shop). Cache per-shop result in Redis with 5-min TTL, invalidated on new review POST.
  - Action: document in BLUEPRINT.md §2. Wire cache invalidation in S4 when review POST is built.

- [ ] **S0.5-L** Notification model missing `title`/`titleAr` — **fix before S10**
  - Frontend `AccountNotification` type expects `{ title, titleAr, message, messageAr }`.
  - DB model in BLUEPRINT §12 only has `message` and `messageAr`.
  - Action: add `title String` and `titleAr String` to `Notification` model in `schema.prisma`. Run migration before S10. Update BLUEPRINT.md §12.

- [ ] **S0.5-M** VIP sort in queue impossible for walk-ins — **fix before S7**
  - `QueueEntry` has no `isVip` field. Walk-in entries have no customer ID — can't look up VIP status.
  - Fix: add `isVip Boolean @default(false)` to `QueueEntry`. Walk-in form passes this flag; booking-linked entries copy it from `User.isVip` at insert time.
  - Action: add field to schema, run migration, update BLUEPRINT.md §7 DB model.

- [x] **S0.5-N** `distance` field — format and who computes it — **decide before S3**
  - Frontend DiscoveryShop expects a `distance` field (currently `"1.2 km"` in mock).
  - AGENTS.md rule: never return pre-formatted strings.
  - Decision: `GET /shops` accepts optional `?lat&lng` query params. Backend computes Haversine distance in meters, returns raw `distanceMeters: number | null` (null if no coords sent). Frontend formats via its own `fmtDistance()` util.
  - Action: update BLUEPRINT.md §2 to document `?lat&lng` params and `distanceMeters` field. Frontend type update needed when wiring.

- [ ] **S0.5-O** Review `commentAr` — bilingual strategy unclear — **decide before S4/S8**
  - BLUEPRINT §3 frontend shape shows `{ comment, commentAr }` but the FormData only has one `comment` field, and the DB model has no `commentAr` column.
  - Decision: customers write in one language. `commentAr` is not a separate field — the API returns `comment` for both language contexts (the review is shown as-is regardless of the reader's language). Remove `commentAr` from the frontend type contract and always return `comment`.
  - Action: update BLUEPRINT.md §3 review shape to remove `commentAr`. Confirm with frontend that the type change is acceptable.

---

## Phase S1 — Project Scaffold ⏳

> Zero features. Get the shell right first — everything else builds on it.

- [x] **S1.1** `package.json` — init with `express`, `prisma`, `@prisma/client`, `zod`, `jsonwebtoken`, `bcrypt`, `helmet`, `cors`, `express-rate-limit`, `morgan`, `winston`, `dotenv`. Dev: `typescript`, `tsx`, `@types/*`, `vitest`, `supertest`.
- [x] **S1.2** `tsconfig.json` — strict mode, `moduleResolution: Node`, `module: CommonJS`, `outDir: dist`, `rootDir: src`, path aliases `@/*` → `src/*`.
- [x] **S1.3** Folder structure — create all directories from `AGENTS.md` project structure section.
- [x] **S1.4** `src/config/env.ts` — Zod schema validates all required env vars on startup. Hard crash if any missing.
- [x] **S1.5** `src/config/prisma.ts` — singleton PrismaClient. `process.env.NODE_ENV !== 'production'` → attach to `global` to survive hot reload.
- [x] **S1.6** `src/app.ts` — `createApp()` factory: helmet, cors, rate-limit, morgan, json parser, mount routes, error handler. No `app.listen` here.
- [x] **S1.7** `src/server.ts` — calls `createApp()`, `prisma.$connect()`, then `app.listen(PORT)`.
- [x] **S1.8** `src/middleware/error-handler.ts` — global Express error handler. Maps known error codes to HTTP status. Logs via Winston. Never exposes stack traces in production.
- [x] **S1.9** `src/lib/redis.ts` — singleton ioredis client. Attach to `globalThis` in non-production to survive hot reload. Export `redisClient`. Wire `redisClient.quit()` into SIGTERM/SIGINT handler in `server.ts`.
- [x] **S1.10** `src/lib/lang.ts` — `getLang(req): 'ar' | 'en'`. Resolves: `?lang=` param → `Accept-Language` header → default `'ar'`. Single source of truth — all route handlers and error handler import from here.
- [x] **S1.11** `src/lib/response.ts` — typed response helpers: `ok(res, data)` → `{ data }`, `paginated(res, data, meta)` → `{ data, meta }`. Keeps all responses in the documented envelope shape.
- [x] **S1.12** `src/lib/queue.ts` — BullMQ `Queue` factory. Export named queues: `hairAnalysisQueue`, `notificationQueue`, `loyaltyQueue`. Each backed by the same `redisClient` connection options. Used by route handlers to enqueue; workers live in `src/jobs/`.
- [x] **S1.13** `src/middleware/validate.ts` — factory: `validate(schema)` → Zod parse → `next()` or `400 { errors }`.
- [x] **S1.14** `src/middleware/auth.ts` — reads `Authorization: Bearer <token>`, verifies JWT, sets `req.user = { id, role, shopId }`. Returns `401` if missing/invalid, `403` if expired.
- [x] **S1.15** `src/middleware/require-role.ts` — `requireRole(...roles)` factory. Returns `403` if `req.user.role` not in list.
- [x] **S1.16** `src/middleware/require-plan.ts` — `requirePlan(minPlan)` factory. Fetches shop from DB, checks plan rank. Returns `403 { error: 'plan_required', requiredPlan }`.
- [x] **S1.17** `src/middleware/require-ownership.ts` — `requireOwnership(getShopId)` factory. Extracts `shopId` from route via the provided getter, compares to `req.user.shopId`. Returns `403` on mismatch. Admin role bypasses.
- [x] **S1.18** `src/middleware/require-shop-status.ts` — for `APPROVED`-only routes (e.g. `/dashboard/*`). Reads shop from DB, returns `403` with the correct status code (`shop_pending`, `shop_rejected`, `shop_suspended`) if not `APPROVED`.
- [x] **S1.19** `src/types/express.d.ts` — augment `Express.Request` with `user: { id: string; role: UserRole; shopId?: string; isVip?: boolean }` and `requestId: string`.
- [x] **S1.20** `prisma/schema.prisma` — full schema from `BLUEPRINT.md` (all models from §1 through §21). Run `prisma generate` + `prisma migrate dev --name init`.
- [x] **S1.21** `.env.example` — all required env vars with placeholder values. No real secrets.
- [x] **S1.22** Health check — `GET /health` returns `{ ok: true, env, version }`. No auth. Used by deploy pipeline.

---

## Phase S2 — Auth: OTP + JWT + Invites ⏳

> Blueprint: §1. This phase unlocks real sessions. Frontend can drop `dev_session` fallback once this is live.

- [x] **S2.1** OTP service (`src/services/otp.service.ts`) — `requestOtp(phone)`: generate 6-digit code, bcrypt-hash, save to `OtpCode` table (5-min TTL), send via WhatsApp (Unifonic/Twilio). `verifyOtp(phone, code)`: find latest unused code, check attempts ≤ 5, compare hash, mark used.
- [x] **S2.2** JWT lib (`src/lib/jwt.ts`) — `signAccess(payload)` (15min), `signRefresh(payload)` (7d), `verifyAccess(token)`, `verifyRefresh(token)`.
- [x] **S2.3** `POST /auth/request-otp` — public. Zod: `{ phone }`. Rate-limit: 3 req/min per IP. Returns `{ ok: true }`.
- [x] **S2.4** `POST /auth/verify-otp` — public. Zod: `{ phone, otp, name?, shopName?, isRegister? }`. Creates or finds `User`. Issues access + refresh tokens. Sets `refreshToken` as httpOnly cookie. Returns `{ accessToken, role }`.
- [x] **S2.5** `POST /auth/refresh` — reads refresh token from cookie or body. Validates against `RefreshToken` table. Issues new access token. Returns `{ accessToken }`.
- [x] **S2.6** `POST /auth/logout` — auth required. Deletes `RefreshToken` record. Clears cookie. Returns `{ ok: true }`.
- [x] **S2.7** `GET /auth/me` — auth required. Returns `{ id, phone, name, role, shopId, shopStatus?, plan, isVip }`. `plan` and `isVip` are read by the frontend `getSession()` to gate features. Never compute these client-side.
- [x] **S2.8** OTP rate-limit lockout — after 5 failed `verifyOtp` attempts: set `OtpCode.locked = true`, return `429 { retryAfter: seconds }`. Frontend already handles this state.
- [x] **S2.9** Barber invite — `POST /auth/invite/generate` (Owner JWT): create `InviteCode` (48h TTL, one-time). `GET /auth/invite?code=`: validate + return shop/barber names. `POST /auth/invite/accept`: verify code, run OTP flow, link `User` to `Barber` record, mark code used.
- [x] **S2.10** Shop status endpoint — `GET /shop/status` (Owner JWT): returns `{ status, rejectionReason? }`. Frontend pending screen polls this every 30s.
- [x] **S2.11** Tests — `POST /auth/request-otp` happy path + rate limit. `POST /auth/verify-otp` valid + invalid + locked. `GET /auth/me` with valid/expired token.

---

## Phase S3 — Shops & Discovery ⏳

> Blueprint: §2. Replaces `DISCOVERY_SHOPS` mock. Frontend filter bar wires to real `?search&service&minRating&priceRange&load` params.

- [x] **S3.1** Shop service (`src/services/shop.service.ts`) — `listShops(filters)`: query with search/service/rating/price filters. Compute `load` per shop from live queue counts (see §23). Include `discount` if active. Return paginated list.
- [x] **S3.2** `GET /shops` — public. Query params: `search`, `service`, `minRating`, `priceRange`, `load`, `city`, `limit` (default 20), `offset`. Returns `{ shops[], total, limit, offset }`.
- [x] **S3.3** `GET /shops/:id` — public. Returns full shop + services[] + barbers[] + `discount` + `load`. This replaces the `shop-detail.constants.ts` mock.
- [x] **S3.4** `POST /shops` — Owner JWT. Creates shop (status=PENDING). Used after onboarding wizard step 1. Returns created `Shop`.
- [x] **S3.5** `PATCH /shops/:id` — Owner JWT + ownership check. Updates shop fields. Returns updated `Shop`.
- [x] **S3.6** Cover + logo upload — `POST /shops/:id/cover` and `POST /shops/:id/logo`. Multipart via `multer`. Validate MIME (JPEG/PNG/WebP). Upload to S3. Returns `{ url }`.
- [x] **S3.7** Shop load computation — helper `computeLoad(shopId)`: count `QueueEntry` rows with `status IN (WAITING, IN_CHAIR)`, divide by barber count, return `'low'|'medium'|'high'`. Cache result in Redis 60s TTL.
- [x] **S3.8** `GET /shop/status` — Owner JWT. Returns `{ status, rejectionReason? }`.
- [x] **S3.9** Tests — list with filters, load computation, pagination, ownership guard on PATCH.

---

## Phase S4 — Shop Detail + Barbers + Services ⏳

> Blueprint: §3, §4, §11a. Replaces `barbers.constants.ts`, `service-items.constants.ts`, `reviews.constants.ts`.

- [x] **S4.1** Services CRUD — `GET /shops/:id/services` (public, `isActive=true` only), `POST /shops/:id/services`, `PATCH /shops/:id/services/:serviceId`, `DELETE /shops/:id/services/:serviceId` (block if upcoming bookings). All owner-JWT + ownership-checked.
- [x] **S4.2** Service active toggle — `PATCH /shops/:id/services/:serviceId` with `{ isActive }`. Customer-facing endpoints always filter `isActive: true`.
- [x] **S4.3** Service photo gallery — `POST /shops/:id/services/:serviceId/photos` (S3 upload), `DELETE /photos/:photoId`, `PATCH /shops/:id/services/:serviceId/photos/reorder`.
- [x] **S4.4** Barbers CRUD — `GET /shops/:id/barbers` (public), `POST /shops/:id/barbers`, `PATCH /shops/:id/barbers/:barberId`, `DELETE /shops/:id/barbers/:barberId` (soft-deactivate). Owner JWT.
- [x] **S4.5** Barber schedule — `PATCH /shops/:id/barbers/:barberId/schedule` with weekly availability array.
- [x] **S4.6** Barber portfolio — `POST /barbers/:id/portfolio` (S3 upload), `DELETE /barbers/:id/portfolio/:photoId`, `PATCH /barbers/:id/portfolio/reorder

`.

- [x] **S4.7** Barber public profile — `GET /barbers/:id` returns full profile shape (see §4 in BLUEPRINT.md). `GET /barbers/:id/reviews`, `GET /barbers/:id/availability`, `GET /barbers/:id/portfolio`.
- [x] **S4.8** Reviews — `GET /shops/:id/reviews` (paginated, `isVisible=true` for public, all for owner dashboard), `POST /reviews` (customer JWT, FormData + photo upload), `POST /reviews/:id/flag` (owner), `PATCH /reviews/:id/flag` (admin — approve/remove).
- [x] **S4.9** Tests — service toggle propagation, review one-per-booking guard (409), flag lifecycle.

---

## Phase S5 — Booking Wizard + Availability ⏳

> Blueprint: §5. The slot availability endpoint is the most critical — it's what drives the time-slot calendar.

- [x] **S5.1** Availability service (`src/services/availability.service.ts`) — given `shopId`, `date`, `barberId?`: get barber schedule for that day, subtract confirmed bookings, return free 30-min slots as ISO time strings. Respect `REGULAR_DAYS_AHEAD=3` / `VIP_DAYS_AHEAD=7` window.
- [x] **S5.2** `GET /shops/:id/availability` — public with optional auth. Query: `?date&barberId`. Returns `{ slots: string[] }`. VIP check: if authenticated and `user.isVip`, allow up to 7 days ahead; else 3 days.
- [ ] **S5.3** Booking creation service (`src/services/booking.service.ts`) — `createBooking(customerId, data)`: (1) check `ReliabilityRecord` → block if score=0 or noShowCount≥3. (2) Check slot conflict (no overlapping confirmed bookings for barber). (3) Fetch discount, compute `totalPrice` + `deposit` using authoritative formula. (4) Snapshot `barberName`, `discountPct`, service names+prices into `BookingService`. (5) All in one Prisma transaction.
- [ ] **S5.4** `POST /bookings` — Customer JWT. Zod: `{ shopId, serviceIds[], barberId?, slot, paymentMethod }`. Returns `{ bookingId, depositAmount, paymentReference }`.
- [ ] **S5.5** Deposit formula enforcement — `Math.round((discountedSubtotal * depositRate) / 250) * 250`. `depositRate` comes from `ReliabilityRecord.score` (see §20). Never trust client-sent amount.
- [ ] **S5.6** Tests — slot conflict guard, VIP window enforcement, blocked customer returns 403, discount claim atomicity.

---

## Phase S6 — Checkout + Payments ⏳

> Blueprint: §6. Iraqi payment gateways. Start with ZainCash (most common), add FIB + PayTabs after.

- [ ] **S6.1** Payment service (`src/services/payment.service.ts`) — `initiate(bookingId, method)`: fetch booking, call gateway API, return `{ gatewayUrl }` (ZainCash redirect) or `{ reference }` (FIB). `handleCallback(payload, signature)`: verify webhook signature, update `Booking.paymentStatus`, trigger post-payment jobs.
- [ ] **S6.2** `POST /payments/initiate` — Customer JWT. Zod: `{ bookingId, method }`. Returns gateway redirect or reference.
- [ ] **S6.3** `POST /payments/callback` — public webhook. Verify signature per gateway docs. Update `BookingPaymentStatus → PAID`. Queue: credit loyalty points job, send confirmation notification job.
- [ ] **S6.4** `GET /payments/:bookingId/status` — Customer JWT. Returns `{ status: PaymentStatus }`. Frontend polls this after redirect.
- [ ] **S6.5** ZainCash integration — sandbox + prod endpoints. HMAC signature generation + verification.
- [ ] **S6.6** FIB integration — sandbox + prod. FIB OAuth token flow + payment creation.
- [ ] **S6.7** PayTabs Iraq integration — card payment session creation + IPN verification.
- [ ] **S6.8** Post-payment BullMQ jobs — `credit-loyalty-points` (§19 earn formula), `send-booking-confirmation` (WhatsApp + in-app notification).
- [ ] **S6.9** Tests — signature verification, double-payment guard (idempotent callback), loyalty earn triggered exactly once per booking.

---

## Phase S7 — Queue Management ⏳

> Blueprint: §7. Powers the dashboard queue page and customer queue-tracking page.

- [ ] **S7.1** Queue service (`src/services/queue.service.ts`) — `getQueue(shopId)`, `addWalkIn(shopId, data)`, `updateStatus(entryId, status)`, `reorder(entryId, newPosition)`. Recalculates `estimatedWait` on every mutation.
- [ ] **S7.2** `GET /shops/:id/queue` — Owner/Barber JWT. Returns sorted `QueueEntry[]` with `estimatedWait` per entry.
- [ ] **S7.3** `GET /queue/:bookingId` — Customer JWT. Returns `QueueEntry` for that booking (position, wait, status).
- [ ] **S7.4** `POST /shops/:id/queue/walk-in` — Owner/Barber JWT. Inserts at end. Returns new entry.
- [ ] **S7.5** `PATCH /queue/:entryId/start` — Barber JWT. Status → `IN_CHAIR`.
- [ ] **S7.6** `PATCH /queue/:entryId/done` — Barber JWT. Status → `DONE`. Triggers reliability `+15` job for customer.
- [ ] **S7.7** `PATCH /queue/:entryId/no-show` — Barber JWT + confirm. Status → `NO_SHOW`. Triggers reliability `−20` job.
- [ ] **S7.8** `PATCH /queue/:entryId/reorder` — Owner JWT. Validates new position, updates all affected positions atomically.
- [ ] **S7.9** VIP sort — if `Shop.vipLaneEnabled`, sort VIP customers to front of WAITING entries before returning list.
- [ ] **S7.10** Tests — wait time calculation, VIP sort, reorder atomicity, no-show reliability deduction.

---

## Phase S8 — Booking History + Reviews ⏳

> Blueprint: §8. Replaces `useAppointmentsStore` localStorage reads with real API calls.

- [ ] **S8.1** `GET /bookings` — Customer JWT. Returns booking list (full shape from §8). Sorted by slot desc.
- [ ] **S8.2** `GET /bookings/:id` — Customer JWT. Single booking receipt shape.
- [ ] **S8.3** `PATCH /bookings/:id/cancel` — Customer JWT. Block if `slot < now + 2h` (422). If late cancel: queue reliability `−10` job. Update status → `CANCELLED`. Trigger refund job if deposit paid.
- [ ] **S8.4** `POST /reviews` — Customer JWT. FormData. Guard: `Booking.hasReview` must be false (409 if true). Upload photos to S3. Set `Booking.hasReview = true`.
- [ ] **S8.5** `POST /reviews/:id/flag` — Owner JWT. Only owner of that shop may flag. Sets `flagStatus = PENDING`.
- [ ] **S8.6** `PATCH /reviews/:id/flag` — Admin JWT. Actions: `approve` (keep visible) or `remove` (isVisible=false, notify owner).
- [ ] **S8.7** Tests — cancel cutoff (2h guard), double-review guard (409), flag ownership check (403 wrong owner), flag lifecycle.

---

## Phase S9 — Dashboard Analytics ⏳

> Blueprint: §11. Owner sees shop-wide data. Barber sees only their own rows.

- [ ] **S9.1** `GET /dashboard/stats` — Owner/Barber JWT. Returns `{ todayBookings, todayRevenue, queueLength, avgWaitMin }`. Scoped by role.
- [ ] **S9.2** `GET /dashboard/activity` — Owner JWT. Last 10 events from `Notification` table for this shop.
- [ ] **S9.3** `GET /dashboard/analytics` — Owner/Barber JWT. Query: `?range=today|week|month|custom&start&end`. Scoped by role (see §11 backend scoping rules).
- [ ] **S9.4** `GET /dashboard/analytics/barbers` — Owner JWT only. Per-barber revenue/bookings/avgRating. Returns 403 for barber role.
- [ ] **S9.5** `GET /dashboard/analytics/top-services` — Owner/Barber JWT. Top services by booking count + revenue. Scoped by role.
- [ ] **S9.6** `GET /dashboard/analytics/peak-hours` — Owner/Barber JWT. Returns `{ cells[], shopHours }`. `shopHours` comes from `BusinessHours` table. Scoped by role.
- [ ] **S9.7** Tests — barber forbidden from `/analytics/barbers`, revenue scoping correctness, empty range returns zeroed arrays not null.

---

## Phase S10 — Notifications ⏳

> Blueprint: §12. In-app notification bell. Sent by server jobs, not directly by API callers.

- [ ] **S10.1** Notification service (`src/services/notification.service.ts`) — `create(userId, type, message, messageAr, meta?)`. Called internally by BullMQ jobs — never directly from route handlers.
- [ ] **S10.2** `GET /notifications` — Bearer JWT. Returns `{ notifications[], unreadCount }`.
- [ ] **S10.3** `PATCH /notifications/:id/read` — Bearer JWT. Marks single notification read.
- [ ] **S10.4** `PATCH /notifications/read-all` — Bearer JWT. Marks all read for user.
- [ ] **S10.5** Wire notification creation to booking events — confirmed, cancelled, no-show, review-flagged-removed.
- [ ] **S10.6** Tests — unread count accuracy, read-all clears all for correct user only.

---

## Phase S11 — Onboarding Wizard ⏳

> Blueprint: §13. 5-step wizard. Shop enters PENDING after step 5.

- [ ] **S11.1** `POST /onboarding/basics` — Owner JWT. Upsert shop (create or update if rejected). Returns `{ shopId }`.
- [ ] **S11.2** `POST /onboarding/branding` — Owner JWT. Multipart: cover + logo → S3.
- [ ] **S11.3** `POST /onboarding/services` — Owner JWT. Creates `Service[]` records for the shop.
- [ ] **S11.4** `POST /onboarding/hours` — Owner JWT. Creates `BusinessHours[]` records.
- [ ] **S11.5** `POST /onboarding/payment` — Owner JWT. Saves encrypted payment credentials. Sets `shop.status = PENDING`. Notifies admins via in-app notification.
- [ ] **S11.6** Resubmit rule — if shop already exists with `status=REJECTED`, step 1 upserts and resets status to `PENDING`.
- [ ] **S11.7** Admin approval — `PATCH /admin/shops/:id/approve` (sets APPROVED, notifies owner), `PATCH /admin/shops/:id/reject` (sets REJECTED + reason, notifies owner), `PATCH /admin/shops/:id/suspend` (full suspension transaction from §1 in BLUEPRINT.md).
- [ ] **S11.8** Tests — resubmit after rejection, suspension transaction atomicity (all pending bookings cancelled, deposits flagged).

---

## Phase S12 — Platform Settings + Admin ⏳

> Blueprint: §15, §1b. Admin-only endpoints. Maintenance mode + platform config.

- [ ] **S12.1** `GET /admin/platform-config` — Admin JWT. Returns config with `smsApiKeyMasked` (never raw key).
- [ ] **S12.2** `PATCH /admin/platform-config` — Admin JWT. AES-256 encrypt `smsApiKey` before storing. Invalidate Redis cache on update.
- [ ] **S12.3** `POST /admin/platform-config/test-sms` — Admin JWT. Sends real test SMS via configured provider.
- [ ] **S12.4** Maintenance mode middleware — Redis-cached config check on every request. Skip for admin role.
- [ ] **S12.5** Admin users — `GET /admin/users`, `GET /admin/users/:id`, `PATCH /admin/users/:id/role` (enforce role change constraints from §1b), `PATCH /admin/users/:id/suspend`, `DELETE /admin/users/:id` (soft delete — anonymise PII).
- [ ] **S12.6** Session invalidation on role change — delete all `RefreshToken` records for user.
- [ ] **S12.7** `GET /admin/shops/:id/suspend-preview` — returns `{ activeBookings, pendingBookings, pendingDepositsIQD }`.
- [ ] **S12.8** Tests — role change constraint (customer→barber blocked), PII anonymisation on delete, maintenance mode Redis bypass.

---

## Phase S13 — Subscription Plans + Feature Gating ⏳

> Blueprint: §16. Three tiers: FREE / STARTER / PRO.

- [ ] **S13.1** `GET /shops/:id/plan` — Owner JWT. Returns `{ plan, planExpiresAt, features: FeatureSet }`.
- [ ] **S13.2** `PATCH /shops/:id/plan` — Admin JWT. Manual plan upgrade.
- [ ] **S13.3** `PATCH /shops/:id/booking-mode` — Owner JWT. `{ mode: 'QUEUE_ONLY'|'BOOKING_ONLY'|'BOTH' }`.
- [ ] **S13.4** `requirePlan` middleware wired to routes — `POST /bookings` requires STARTER. Analytics requires PRO. Reviews requires PRO. Staff requires PRO.
- [ ] **S13.5** `bookingMode` guard — if `shop.bookingMode === QUEUE_ONLY` and `POST /bookings` called: return `403 { error: 'booking_disabled', mode: 'queue_only' }`.
- [ ] **S13.6** Barber count limit — `POST /shops/:id/barbers`: check plan. FREE→max 1, STARTER→max 2, PRO→unlimited.
- [ ] **S13.7** Tests — plan gate returns 403 with `requiredPlan`, barber count limit per plan tier.

---

## Phase S14 — Loyalty + Reliability + VIP ⏳

> Blueprint: §19, §20, §21. All three systems are security-critical — frontend localStorage is display-only.

- [ ] **S14.1** Loyalty service — `earnPoints(userId, bookingId)`: `Math.floor(totalPrice / 1000)` pts. Atomic upsert `LoyaltyAccount`. Create `LoyaltyTransaction`. Auto-promote tier. If points ≥ 500 and not already VIP, set `User.isVip = true, vipGrantedBy = 'auto'`.
- [ ] **S14.2** `GET /user/loyalty` — Customer JWT. Returns `{ points, tier, pendingReward }`.
- [ ] **S14.3** `POST /user/loyalty/redeem` — Customer JWT. Verify `points >= reward.pointsCost` in DB. Deduct in same transaction as booking. Return 403 if insufficient.
- [ ] **S14.4** Reliability service — `applyEvent(userId, event)`: NO_SHOW−20, LATE_CANCEL−10, COMPLETION+15, ON_TIME+20. Clamp 0–100. `getDepositRate(score)`: <40→0.5, <60→0.3, else 0.2.
- [ ] **S14.5** `GET /user/reliability` — Customer JWT. Returns `{ score, noShowCount, depositRate, isBlocked }`.
- [ ] **S14.6** Reliability events wired — `PATCH /queue/:entryId/no-show` → `applyEvent('NO_SHOW')`. `PATCH /queue/:entryId/done` → `applyEvent('COMPLETION')`. `PATCH /bookings/:id/cancel` (late) → `applyEvent('LATE_CANCEL')`. Booking creation with deposit → `applyEvent('ON_TIME')`.
- [ ] **S14.7** Block enforcement — `createBooking` checks `isBlocked` before proceeding.
- [ ] **S14.8** `POST /admin/users/:id/unblock` — Admin/Owner JWT. Resets `score=60, noShowCount=0`.
- [ ] **S14.9** VIP endpoints — `GET /user/vip`, `POST /admin/users/:id/vip`.
- [ ] **S14.10** Tests — loyalty earn idempotency (no double-credit), reliability clamp at 0/100, block enforcement, VIP auto-grant at 500pts.
- [ ] **S14.11** `GET /user/hair-profile` — Customer JWT. Returns `HairProfile` for the authenticated user. Shape: `{ dryness, damage, scalpCondition, lastTreatmentDate, cutFrequencyWeeks }`. Returns `404` if not yet set.
- [ ] **S14.12** `PUT /user/hair-profile` — Customer JWT. Zod: `{ dryness: z.number().int().min(1).max(5), damage: z.number().int().min(1).max(5), scalpCondition: z.enum(['normal','dry','oily','sensitive']), lastTreatmentDate: z.string().optional(), cutFrequencyWeeks: z.number().int().positive() }`. Upsert `HairProfile`. Returns the saved profile.
- [ ] **S14.13** `GET /user/hair-history` — Customer JWT. Returns the last N `HairAnalysisHistory` rows for this user (newest first). Shape per entry: `{ id, date, hairType, conditionScore, dryness, damage, scalpCondition }`. Sourced from the `HairAnalysisHistory` table (snapshot per analysis), NOT `HairAnalysis` (job tracking).

---

## Phase S15 — Discount System ⏳

> Blueprint: §17. Flash discounts with race-condition-safe slot claiming.

- [ ] **S15.1** `GET /shops/:id/discount` — public. Returns active `DiscountRule | null`.
- [ ] **S15.2** `POST /shops/:id/discount` — Owner JWT. Creates discount. Only one active per shop (`@unique` on `shopId`).
- [ ] **S15.3** `DELETE /shops/:id/discount` — Owner JWT. Removes active discount.
- [ ] **S15.4** Discount claim in booking creation — atomic `UPDATE ShopDiscount SET slotsClaimed = slotsClaimed + 1 WHERE shopId = ? AND slotsClaimed < maxUsers AND expiresAt > NOW()`. Snapshot `discountPct` on `Booking`.
- [ ] **S15.5** `GET /shops` and `GET /shops/:id` — include `discount` field.
- [ ] **S15.6** Tests — race condition (two concurrent bookings, only `maxUsers` get discount), expired discount ignored, post-expiry `slotsClaimed` unchanged.

---

## Phase S16 — Hair Analysis (BullMQ Job) ⏳

> Blueprint: §9. Heavy ML work runs in a BullMQ worker, not in the request handler.

- [ ] **S16.1** `POST /hair-analysis` — Bearer JWT (optional). Multipart image upload → S3. Enqueue `hair-analysis` BullMQ job. Returns `{ jobId }` immediately (202).
- [ ] **S16.2** `GET /hair-analysis/:jobId` — Returns `{ status: 'processing'|'done'|'error', result? }`. Result is the `AnalysisResult` shape from BLUEPRINT §9.
- [ ] **S16.3** BullMQ worker (`src/jobs/hair-analysis.worker.ts`) — fetches image from S3, calls ML service (or mock in dev), writes result to Redis key `hair-analysis:{jobId}`, TTL 1h.
- [ ] **S16.4** Tests — job enqueued on upload, status transitions processing→done, expired job returns 404.

---

## Phase S17 — Contact Form + Saved Shops ⏳

> Blueprint: §10, §18 (`saved-shops-mock.ts`). Small but needed to close all frontend stubs.

- [ ] **S17.1** `POST /contact` — public. Zod: `{ name, email, subject, message }`. Save to `ContactMessage`. Queue email to admin via BullMQ.
- [ ] **S17.2** `GET /account/saved-shops` — Customer JWT. Returns `SavedShop[]`.
- [ ] **S17.3** `POST /account/saved-shops/:shopId` — Customer JWT. Upsert `SavedShop`.
- [ ] **S17.4** `DELETE /account/saved-shops/:shopId` — Customer JWT. Remove.
- [ ] **S17.5** Tests — duplicate save is idempotent, contact message persisted.

---

## Phase S18 — Testing & Hardening ⏳ LAST

### TTL Cleanup Jobs

- [ ] Expired `OtpCode` cleanup — BullMQ repeatable job (every 10 min): `DELETE FROM OtpCode WHERE expiresAt < NOW()`. Prevents table bloat.
- [ ] Expired `RefreshToken` cleanup — BullMQ repeatable job (every 1h): `DELETE FROM RefreshToken WHERE expiresAt < NOW()`.
- [ ] Expired `InviteCode` cleanup — BullMQ repeatable job (every 1h): `DELETE FROM InviteCode WHERE expiresAt < NOW() AND used = false`.

### Security Audit

- [ ] OWASP Top 10 checklist — injection, broken auth, sensitive data, XXE, broken access control, security misconfiguration, XSS, insecure deserialisation, known vulnerabilities, insufficient logging.
- [ ] Rate limits verified — auth endpoints capped at 3–10 req/min per IP.
- [ ] All payment callback endpoints verify gateway signatures — never trust unsigned webhooks.
- [ ] All file upload endpoints validate MIME type server-side, not just file extension.
- [ ] No secrets in logs — Winston transport configured to redact `Authorization`, `password`, `apiKey` fields.
- [ ] `requireOwnership` applied on every mutating shop/barber/service route — verify with a test that attempts cross-shop access (expect 403).
- [ ] `requireShopStatus` applied on all `/dashboard/*` routes — verify with a test using a PENDING shop (expect 403 with `shop_pending`).

### Integration Tests

- [ ] Full booking flow — create account → book → pay → loyalty earned → queue position → complete → review.
- [ ] No-show flow — booking → no-show → reliability deducted → score check.
- [ ] Suspension flow — admin suspends shop → pending bookings cancelled → deposits flagged → notifications sent.
- [ ] Discount race condition test — 10 concurrent requests, only `maxUsers` succeed.

### Performance

- [ ] `GET /shops` under 200ms p99 with 100 shops (Redis queue count cache).
- [ ] `GET /shops/:id/availability` under 100ms (indexed barber schedule queries).
- [ ] `POST /bookings` under 500ms including Prisma transaction.

### Final Checks

- [ ] All env vars documented in `.env.example`.
- [ ] `prisma migrate deploy` runs clean on fresh DB.
- [ ] `npm run build` produces clean `dist/` with no TS errors.
- [ ] Health check `GET /health` returns 200 in production build.

---

## Phase S19 — Google Maps Places Seeder + Monthly Sync ⏳

> **Goal:** Populate the DB with real barbershop data from Anbar Governorate (Iraq) using the Google Maps Places API, then keep the list fresh with a BullMQ monthly job.

### Prerequisites
- Google Maps Places API key (add `GOOGLE_MAPS_API_KEY` to `.env`)
- Shops must be created with `status: PENDING` so the admin can review before approving

### S19.1 — One-time seed script
- [ ] `scripts/seed-anbar-shops.ts` — standalone script (run with `npx tsx scripts/seed-anbar-shops.ts`)
  - Calls Google Maps Places API `nearbySearch` with `location=Anbar` + `type=hair_care|barber_shop` + `radius=50000`
  - Handles pagination (`next_page_token`) to get full result list
  - For each place: fetch details (name, address, phone, lat/lng, rating, photos)
  - Maps to `Shop` schema: `nameEn` from place name, `nameAr` from place name (fallback), `phone`, `lat`, `lng`, `address`, `city='Anbar'`, `status='PENDING'`
  - Skips duplicates by checking `lat+lng` uniqueness before insert
  - Logs: how many found, how many inserted, how many skipped (already exist)

### S19.2 — BullMQ monthly sync job
- [ ] `src/jobs/sync-anbar-shops.job.ts` — BullMQ repeatable job
  - Queue name: `shop-sync`
  - Repeat: every 1st of the month (cron: `0 3 1 * *`)
  - Same logic as seed script but delta-only: only inserts shops not already in DB (matched by `lat+lng` or Google `placeId` stored on the `Shop` model)
  - Sends admin notification when new shops are found: "X new barbershops found in Anbar — pending review"
- [ ] Add `placeId String? @unique` to `Shop` model in `schema.prisma` + migration — used as the dedup key
- [ ] Register the repeatable job in `src/server.ts` on startup (alongside existing cleanup jobs)

### S19.3 — Admin review endpoint
- [ ] `GET /admin/shops/pending` — Admin JWT. Lists all shops with `status: PENDING` so admin can approve/reject imported shops.

### Notes
- All imported shops start as `status: PENDING` — never auto-approve
- `ownerId` for imported shops: create a system user `phone: +9640000000000, role: SHOP_OWNER, name: 'System Import'` and use its ID
- Rate limit: Google Places API allows 60 req/s — add 200ms delay between paginated calls
