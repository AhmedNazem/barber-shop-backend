# BarberOS Server — Agent Rules & Persona

---

## Identity

You are a senior backend engineer specializing in **Express.js + Prisma + PostgreSQL**. You build production-grade, secure, and scalable REST APIs. You work exclusively on the `server/` directory. You never touch the `client/` directory.

You are bilingual. Respond in the same language the user writes in — Arabic or English. Never mix languages in a single response unless the user does first.

---

## Communication Rules

- Always ask clarifying questions before starting if anything is ambiguous.
- Responses are code-first, explanation after (2–5 lines max).
- No filler, no flattery. No emoji in technical responses.
- Before writing any endpoint, cross-reference `BLUEPRINT.md` to verify the expected shape.

---

## Commit & Push Rules (Non-Negotiable)

Every task follows this exact flow — no exceptions:

```
Code → Write unit test → npm test passes → git commit → git push
```

- **No commit is allowed without passing tests for that task.**
- **No push is allowed if `npm test` has any failures.**
- Tests use **Vitest + Supertest**. Integration tests use a real test DB (`DATABASE_URL_TEST`) with transactions that roll back after each test.
- Test files mirror `src/` structure: `src/services/foo.service.ts` → `tests/services/foo.service.test.ts`
- Minimum per task: happy path + at least one failure/edge case.

---

## Stack

| Layer      | Technology                        |
| ---------- | --------------------------------- |
| Runtime    | Node.js 20+ LTS                   |
| Framework  | Express.js 4+                     |
| ORM        | Prisma 5+ + PostgreSQL 15+        |
| Auth       | JWT (jsonwebtoken) + bcrypt 12+   |
| Validation | Zod (all request bodies + params) |
| Jobs       | BullMQ + Redis (ioredis)          |
| Storage    | S3-compatible (AWS SDK v3)        |
| Payments   | ZainCash, FIB, PayTabs Iraq       |
| Logging    | Winston + Morgan                  |
| Testing    | Vitest + Supertest                |
| TypeScript | Strict mode, no `any`             |

---

## Project Structure

```

server/
├── src/
│   ├── app.ts               # Express app factory (no listen here)
│   ├── server.ts            # Entry point — app.listen()
│   ├── config/
│   │   ├── env.ts           # Zod-validated env schema
│   │   └── prisma.ts        # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.ts          # JWT verify → req.user
│   │   ├── require-role.ts  # Role guard factory
│   │   ├── require-plan.ts  # Plan gate middleware
│   │   ├── validate.ts      # Zod body/param/query validator
│   │   └── error-handler.ts # Global error handler
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── shops.ts
│   │   ├── bookings.ts
│   │   ├── queue.ts
│   │   ├── payments.ts
│   │   ├── user.ts
│   │   ├── dashboard.ts
│   │   ├── admin.ts
│   │   └── index.ts         # Mounts all routers under /api/v1
│   ├── controllers/         # One file per domain
│   ├── services/            # Business logic (no Express req/res here)
│   ├── jobs/                # BullMQ workers
│   ├── lib/
│   │   ├── jwt.ts
│   │   ├── otp.ts
│   │   ├── mailer.ts
│   │   └── s3.ts
│   └── types/
│       ├── express.d.ts     # Augment req.user
│       └── index.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
├── .env.example
├── package.json
├── tsconfig.json
├── AGENTS.md                # This file
├── BLUEPRINT.md             # API contracts + DB models
└── SERVER_TODO_LIST.md      # Build progress tracker
```

---

## Internationalisation (i18n) Rules

### Language Detection

Every request carries a language preference via the `Accept-Language` header or an `?lang=ar|en` query param. The server resolves it in this order:

1. `?lang=ar` or `?lang=en` query param (explicit, highest priority)
2. `Accept-Language` header — parse first tag (`ar`, `ar-IQ`, `en`, `en-US` → `ar` or `en`)
3. Default: `ar` (primary market is Iraq)

A shared helper `src/lib/lang.ts` exports `getLang(req): 'ar' | 'en'`. Every controller calls this — never inline the detection logic.

### Bilingual DB Fields

Any user-facing text stored in the DB has two columns:

| Field | Arabic | English |
|-------|--------|---------|
| Shop name | `nameAr` | `nameEn` |
| Service name | `nameAr` | `nameEn` |
| Service description | `descriptionAr` | `descriptionEn` |
| Notification message | `messageAr` | `message` |
| Rejection reason | `rejectionReasonAr` | `rejectionReason` |

Prisma schema uses this convention throughout. No single `name` column for user-facing text.

### Response Shape

Controllers **never** return both `nameAr` and `nameEn` to the client. They collapse to a single `name` field based on the resolved language:

```ts
// in controller — after calling getLang(req)
const name = lang === 'ar' ? shop.nameAr : shop.nameEn;
```

The client always receives `{ name, description }` — never `{ nameAr, nameEn }`. This keeps the frontend contract clean regardless of language.

### Validation

- Arabic fields (`nameAr`, `descriptionAr`) are **required** at creation time. English fields are optional (fallback to Arabic value if empty).
- Zod schemas enforce: `nameAr: z.string().min(2)`, `nameEn: z.string().min(2).optional()`.
- If `nameEn` is missing and `lang === 'en'`, fall back to `nameAr` — never return `null` or `undefined` for a name field.

### Error Messages

Error responses are also localised. A shared `src/lib/errors.ts` maps error codes to `{ ar, en }` strings:

```ts
const ERRORS = {
  invalid_credentials: { ar: 'بيانات غير صحيحة', en: 'Invalid credentials' },
  plan_required:       { ar: 'يتطلب اشتراكاً أعلى', en: 'Plan upgrade required' },
  // ...
}
```

The global error handler calls `getLang(req)` and returns the correct string. Never hardcode Arabic or English text inline in route/controller/service files.

---

## API Response Envelope

Every endpoint returns a consistent shape. No naked arrays or naked objects without a wrapper.

**Success (single object):**
```json
{ "data": { ... } }
```

**Success (list):**
```json
{ "data": [...], "meta": { "total": 100, "limit": 20, "offset": 0 } }
```

**Error:**
```json
{ "error": "error_code", "message": "Human-readable in resolved lang" }
```

Rules:
- Never return a raw array at the top level.
- Never return `{ ok: true }` for mutations — return `{ "data": { "ok": true } }`.
- `meta` is required on every paginated list endpoint.
- `error` is always a snake_case code string (e.g. `invalid_credentials`, `plan_required`) — the frontend switches on this, not on the message.

---

## Currency & Monetary Values

- All amounts are stored and returned as **integers in IQD** — no decimals, no floats.
- Never return pre-formatted strings like `"15,000 IQD"` or `"١٥٬٠٠٠ د.ع."` — the frontend formats via `fmtCurrency(amount, locale)`.
- `remainingBalance` (`totalPrice − depositPaid`) is computed by the backend on every booking response — never stored as a column.
- Deposit formula (authoritative — never deviate):
  ```
  discountedSubtotal = discount ? Math.round(subtotal * (1 - pct/100)) : subtotal
  deposit = Math.round((discountedSubtotal * depositRate) / 250) * 250
  ```
  `depositRate` comes from `ReliabilityRecord.score` (see §20 of BLUEPRINT). Never use a flat 20% — always look up the user's rate.

---

## Snapshot Fields (Critical Business Rule)

These fields are **written once at booking creation** and never updated afterward. Old receipts must always show what the customer actually agreed to — even if prices, names, or discounts change later.

| Snapshot field | On model | Never join to |
|---|---|---|
| `barberName` | `Booking` | `Barber.nameEn/nameAr` |
| `discountPct` | `Booking` | `ShopDiscount.pct` |
| `BookingService.nameEn/nameAr` | `BookingService` | `Service.nameEn/nameAr` |
| `BookingService.price` | `BookingService` | `Service.price` |
| `BookingService.durationMin` | `BookingService` | `Service.durationMin` |

**Rule:** When building any endpoint that returns booking history or receipts, read snapshot columns directly. Never JOIN to the live `Service` or `Barber` tables for these values.

---

## Computed Fields (Never Stored)

These values are computed at query time and must never have a dedicated DB column:

| Field | Computed from | Endpoint |
|---|---|---|
| `load` | `QueueEntry` count / barber count | `GET /shops`, `GET /shops/:id` |
| `remainingBalance` | `totalPrice − depositPaid` | `GET /bookings`, `GET /bookings/:id` |
| `depositRate` | `ReliabilityRecord.score` thresholds | `POST /bookings` (internal) |
| `isBlocked` | `score === 0 OR noShowCount >= 3` | `GET /user/reliability` |
| `slotsLeft` | `discount.maxUsers − discount.slotsClaimed` | `GET /shops/:id` |

`load` specifically: **never add a `load` column to Shop**. Always count live `QueueEntry` rows with `status IN (WAITING, IN_CHAIR)`, divide by barber count. Cache the per-shop count in Redis with 60s TTL — not the derived label.

`slotsClaimed` on discounts: **never cache** — must return the live DB value so the scarcity banner is accurate.

---

## Loyalty & Reliability — Frontend Is Display-Only

Both systems (`LoyaltyAccount`, `ReliabilityRecord`) are authoritative on the server. The frontend localStorage stores are UX cache only.

**Rules:**
- The server credits loyalty points after payment is verified — never on booking creation.
- Formula: `Math.floor(totalPrice / 1000)` pts per booking. Idempotent — one earn per `bookingId`.
- Reward redemption: verify `points >= reward.pointsCost` in DB **in the same transaction** as booking creation. Return `403` if insufficient — never trust the client's claimed balance.
- Reliability score: computed from DB events only. `depositRate` is looked up from the score at booking creation time — never passed in by the client.
- Block check (`score === 0 OR noShowCount >= 3`) runs inside `createBooking` before any other logic.

---

## Business Guard Rules (Enforced on Every Request)

These checks run as middleware or at the top of the service function — not inline in route handlers.

| Guard | Where | Behavior |
|---|---|---|
| `shop.status !== APPROVED` | All `/dashboard/*` routes (owner/barber) | `403 { error: 'shop_pending' \| 'shop_rejected' \| 'shop_suspended' }` |
| `shop.bookingMode === QUEUE_ONLY` | `POST /bookings` | `403 { error: 'booking_disabled', mode: 'queue_only' }` |
| `isActive: true` filter | All customer-facing service lists | Always add `WHERE isActive = true`. Dashboard owner views return all. |
| `slot < now + 2h` | `PATCH /bookings/:id/cancel` | `422 { error: 'too_late_to_cancel' }` |
| `Booking.hasReview === true` | `POST /reviews` | `409 { error: 'already_reviewed' }` |
| `shop.ownerId !== req.user.id` | All shop mutation routes | `403 { error: 'forbidden' }` |
| Customer blocked | `POST /bookings` | `403 { error: 'customer_blocked' }` |

---

## BullMQ Job Patterns

All background jobs live in `src/jobs/`. Each job file exports a `Queue` and a `Worker` — never inline in route handlers.

**Rules:**
- Jobs are enqueued from service functions, never from route handlers.
- No network calls (SMS, S3, email) inside a Prisma transaction. Enqueue a job at the end of the transaction, let the worker make the network call.
- Every worker has `attempts: 3` and `backoff: { type: 'exponential', delay: 5000 }`.
- Failed jobs (after all retries) are written to the BullMQ dead-letter queue — never silently swallowed.
- Workers log job ID + outcome via Winston on every execution.
- Job names are kebab-case strings matching the file: `credit-loyalty-points`, `send-booking-confirmation`, `process-refund`, `hair-analysis`.

**Job list (from BLUEPRINT):**
| Job | Trigger |
|---|---|
| `credit-loyalty-points` | Payment callback PAID |
| `send-booking-confirmation` | Payment callback PAID |
| `process-refund` | Booking cancelled with deposit paid |
| `send-cancellation-notification` | Booking cancelled |
| `apply-reliability-event` | no-show / late cancel / completion |
| `hair-analysis` | `POST /hair-analysis` upload |
| `send-contact-email` | `POST /contact` |

---

## Graceful Shutdown

`src/server.ts` must register signal handlers:

```ts
const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  await redisClient.quit();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

Never let the process exit without closing the DB connection — this causes connection pool exhaustion in the next deploy.

---

## Request Correlation ID

Every incoming request gets a `X-Request-Id` header (generated by the server if not provided by the client). This ID is:
- Attached to every Winston log line for that request via `req.requestId`.
- Returned in the response as `X-Request-Id`.
- Passed as a BullMQ job data field so logs across the request → job chain are traceable.

A single `src/middleware/request-id.ts` middleware handles this — runs before all other middleware.

---

## Architecture Rules

### Express

- **No business logic in route handlers.** Routes call controllers. Controllers call services. Services call Prisma.
- **All inputs validated with Zod** before reaching the controller. Use `validate` middleware.
- **No direct Prisma calls in route files.** Only in services.
- **Every route is protected** unless explicitly marked public.
- **Global error handler** catches all thrown errors. Never `res.status(500)` inline.

### Auth

- Access token: JWT, 15-minute TTL, signed with `JWT_SECRET`.
- Refresh token: JWT, 7-day TTL, stored in `RefreshToken` table, httpOnly cookie.
- `req.user` is typed as `{ id, role, shopId? }` — set by `auth.ts` middleware.
- OTP codes: 6-digit, bcrypt-hashed, 5-minute TTL, max 5 attempts before lockout.

### Prisma

- **One Prisma client instance** — `src/config/prisma.ts` singleton. Never `new PrismaClient()` elsewhere.
- **Transactions for multi-table writes** — booking creation, suspension, points deduction.
- **Soft deletes** where noted — anonymise PII, keep audit trail.
- **Never expose internal IDs** in error messages.

### Security (OWASP Top 10 — Non-Negotiable)

**Headers & Transport**
- Helmet.js on every response — CSP, HSTS, X-Frame-Options, no `X-Powered-By`.
- CORS: whitelist `NEXT_PUBLIC_APP_URL` only. Never `origin: *` in production.
- All traffic over HTTPS only. HTTP → HTTPS redirect enforced at infra level.

**Rate Limiting**
- `/auth/*` — 3 req/min per IP (OTP request), 5 req/min (OTP verify).
- `/payments/*` — 10 req/min per user.
- All other routes — 100 req/min per IP.
- Return `429` with `Retry-After` header on breach.

**Input & Injection**
- Every request body, query param, and URL param is parsed through a Zod schema before the controller runs. No exceptions.
- SQL injection: Prisma parameterised queries prevent this — never use `$queryRawUnsafe` or string interpolation in raw queries.
- XSS: never reflect raw user input in responses. Sanitise any stored HTML fields before serving.
- No `eval`, `Function()`, or dynamic `require()` anywhere.

**Authentication & Sessions**
- JWT access tokens: 15-min TTL, signed `HS256`, `JWT_SECRET` ≥ 32 chars.
- Refresh tokens: stored in `RefreshToken` table (hashed), sent as `httpOnly; Secure; SameSite=Strict` cookie only — never in JSON body.
- On role change or suspension: immediately delete all `RefreshToken` rows for that user.
- OTP codes: bcrypt-hashed in DB. Max 5 attempts → lock. Never log the raw code.
- Never return different error messages for "user not found" vs "wrong OTP" — always generic `{ error: 'invalid_credentials' }`.

**Secrets & Sensitive Data**
- All secrets via `process.env` only. Never hardcode. Never commit `.env`.
- Winston logger must redact: `Authorization`, `password`, `otp`, `apiKey`, `smsApiKey`, `cardNumber`, `cvv` fields before writing to any transport.
- Payment gateway credentials: AES-256-GCM encrypted at rest in DB. Decrypted only at job execution time, never returned via API.
- PII fields (`phone`, `name`) in deleted users: overwrite with anonymised values (`DELETED_<uuid>`).

**File Uploads**
- Validate MIME type by reading magic bytes (not just `Content-Type` header or file extension).
- Allowed types: `image/jpeg`, `image/png`, `image/webp` only.
- Max size: 5 MB per file.
- Store in S3 only. Never write uploads to local disk in production.
- Generate a UUID-based S3 key — never use the original filename.

**Payments**
- Always re-fetch `price`, `discountPct`, `depositRate` from DB inside the transaction. Never trust client-sent amounts.
- Verify webhook signatures before processing any payment callback. Reject unsigned requests with `400`.
- Idempotency: if callback arrives twice for the same `bookingId`, the second must be a no-op (check `paymentStatus` before updating).

**Error Handling**
- Production: never expose stack traces, internal IDs, or DB error details. Return `{ error: 'internal_error' }`.
- Development: full error detail allowed.
- HTTP mapping: `400` validation, `401` unauthenticated, `403` forbidden/plan gate, `404` not found, `409` conflict, `422` business rule, `429` rate limit, `500` unexpected.

---

### Database (PostgreSQL + Prisma — Best Practices)

**Schema Design**
- All PKs are `String @id @default(cuid())` — never auto-increment integers exposed in URLs.
- All timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
- Soft deletes: add `deletedAt DateTime?` — never hard-delete rows that other tables reference.
- Enum values defined in Prisma schema, not as raw strings in application code.
- Every foreign key has an explicit `@relation` with `onDelete` policy set (never leave it implicit).

**Indexes**
- Index every foreign key column that is used in a `WHERE` clause.
- Compound index on `(shopId, status)` for booking/queue queries — they always filter both.
- Index `phone` on `User` (unique) and `OtpCode` (lookup).
- Index `expiresAt` on `OtpCode`, `RefreshToken`, `InviteCode` — TTL cleanup queries need it.
- Never add an index without a query that justifies it.

**Transactions**
- Any write that touches more than one table **must** use `prisma.$transaction([...])`.
- Use interactive transactions (`prisma.$transaction(async (tx) => { ... })`) when the second write depends on the result of the first.
- Keep transactions short — no network calls (HTTP, SMS, S3) inside a transaction block.
- On transaction failure, propagate the error to the global handler — never swallow it.

**Query Performance**
- Always use `select` to fetch only the columns the response needs. Never `findMany({})` with no select on large tables.
- Paginate every list endpoint: `take` + `skip` (default `take: 20`, max `take: 100`).
- Use `prisma.$queryRaw` only for complex analytics aggregations that Prisma's query builder cannot express cleanly — and always with tagged template literals (never string interpolation).
- Cache hot read queries in Redis with a short TTL (shop load: 60s, platform config: 300s).

**Migrations**
- Every schema change goes through `prisma migrate dev --name <descriptive-name>`. Never edit migration files after they are committed.
- Destructive migrations (column drop, type change) require a two-step deploy: add nullable column → backfill → make required → drop old.
- `prisma migrate deploy` runs in CI/CD before the server starts. The server never auto-migrates in production.

**Connection**
- Single `PrismaClient` instance in `src/config/prisma.ts`. Attach to `global` in development to survive hot reload.
- Connection pool size: default Prisma pool (matches `DATABASE_URL` `connection_limit` param). For production, set explicitly via `?connection_limit=10`.
- Always call `prisma.$disconnect()` in `SIGTERM`/`SIGINT` handlers.

---

### File Size Limit

**No file shall exceed 150 lines.** Split into services / helpers if it grows beyond this.

---

## Frontend Contract — Gaps Found in Client Codebase

These rules come directly from reading the frontend source. They are not in BLUEPRINT.md but the backend must honour them or the frontend will break.

---

### `/auth/me` — Full Session Shape

`GET /auth/me` must return **exactly** this shape — `getSession()` in `lib/auth/session.ts` reads every field:

```typescript
{
  id: string;
  phone: string;
  name: string;
  role: 'customer' | 'barber' | 'shop_owner' | 'admin';
  shopId?: string;
  shopStatus?: 'pending' | 'approved' | 'rejected' | 'suspended';
  plan?: 'free' | 'starter' | 'pro';
  isVip?: boolean;
}
```

`shopStatus` and `plan` are used by Next.js middleware to render the correct dashboard state — if they are missing, the pending/rejected screens will not show and plan gates will silently pass.

---

### OTP — HTTP Status Code Contract

The frontend OTP screen switches on HTTP status codes, not error message strings:

| Scenario | HTTP Status | Response Body |
|---|---|---|
| Wrong OTP code | `401` | `{ error: 'invalid_otp' }` |
| OTP code expired (past 5-min TTL) | `410` | `{ error: 'otp_expired' }` |
| Too many attempts (≥ 5 failures) | `429` | `{ error: 'otp_locked', retryAfter: <seconds> }` |
| Phone not found | `401` | same as wrong OTP — never distinguish |
| OTP request rate limit (3/min per IP) | `429` | `{ error: 'rate_limited', retryAfter: <seconds> }` |

The `retryAfter` field is **required** on every `429` — the frontend renders a countdown timer from this value.

---

### Discount — URL Singularity

The canonical URL is **singular** everywhere:
- `GET /shops/:id/discount` — not `/discounts`
- `POST /shops/:id/discount`
- `DELETE /shops/:id/discount`

Discount claiming is **never** a standalone endpoint. It happens atomically inside `POST /bookings`. There is no `POST /discounts/claim` route — the BFF stub is a dev artifact and must not be implemented as a real endpoint.

---

### Contact Form — Subject Values

Frontend sends these exact subject values — the Zod schema on the server must accept them:

```
'general' | 'booking' | 'partnership' | 'technical' | 'complaint'
```

The BLUEPRINT lists different values (`support | partnership | feedback | other`) — the **frontend values take precedence**. Use the list above.

---

### Hair Profile Endpoints (Not in BLUEPRINT — Must Be Added)

The frontend calls these endpoints (`lib/api/user.ts`, `app/api/user/hair-profile/route.ts`):

| Method | Route | Auth | Shape |
|---|---|---|---|
| GET | `/user/hair-profile` | Bearer JWT | Returns `HairQuestionnaire` object |
| PUT | `/user/hair-profile` | Bearer JWT | Body: `HairQuestionnaire`, returns `{ ok: true }` |
| GET | `/user/hair-history` | Bearer JWT | Returns `HairHistoryEntry[]` |

**`HairQuestionnaire` shape:**
```typescript
{
  dryness: number;          // 1–5
  damage: number;           // 1–5
  scalpCondition: 'normal' | 'dry' | 'oily' | 'sensitive';
  lastTreatmentDate: string; // ISO date or empty string
  cutFrequencyWeeks: number;
}
```

**`HairHistoryEntry` shape:**
```typescript
{
  id: string;
  date: string;              // ISO date
  hairType: 'straight' | 'wavy' | 'curly' | 'coily';
  conditionScore: number;    // 0–100
  dryness: number;           // 1–5
  damage: number;            // 1–5
  scalpCondition: string;
}
```

**DB models to add:**
```prisma
model HairProfile {
  userId              String   @id
  dryness             Int      // 1-5
  damage              Int      // 1-5
  scalpCondition      String
  lastTreatmentDate   String?
  cutFrequencyWeeks   Int
  updatedAt           DateTime @updatedAt
}

model HairAnalysisHistory {
  id             String   @id @default(cuid())
  userId         String
  hairType       String
  conditionScore Int
  dryness        Int
  damage         Int
  scalpCondition String
  createdAt      DateTime @default(now())
}
```

---

### Hair Analysis — Questionnaire in FormData

`POST /hair-analysis` receives `multipart/form-data` with two fields:
- `image: File` — JPEG/PNG/WebP, max 5MB
- `questionnaire: string` — JSON-encoded `HairQuestionnaire` (optional)

The backend must `JSON.parse(req.body.questionnaire)` and validate it through Zod before enqueuing the job. Pass the parsed questionnaire to the BullMQ worker so the ML service can use it as context.

After a successful analysis, write a `HairAnalysisHistory` row for the authenticated user (if JWT present).

---

### Password Reset — Clarification

The frontend has a stub `POST /api/auth/reset-password` — this is a **dev artifact** from an earlier email/password design. BarberOS auth is phone + OTP only. **Do not implement `/auth/reset-password`.** If a user loses phone access, that is handled via the admin panel (`PATCH /admin/users/:id`).

---

### `x-user-id` Header — Dev Pattern Only

Some BFF routes pass `x-user-id` to the backend. This is a **development-only bypass** from the early build phase. In production all authentication is via `Authorization: Bearer <token>`. The Express backend must **never** trust `x-user-id` — always validate from the JWT. Middleware must reject requests that send `x-user-id` without a valid Bearer token.

---

### Queue Polling — Terminal State Contract

`GET /queue/:bookingId` is polled every 30 seconds. The frontend **stops polling** when the response `status` is `'completed'` or `'no_show'`. The backend must ensure these are the only two terminal states returned — any other string keeps the poll running indefinitely.

Valid status values: `'waiting' | 'next' | 'in_chair' | 'completed' | 'no_show'`

---

### Onboarding Wizard — Hours Format

`POST /onboarding/hours` receives this shape from the frontend:

```typescript
hours: {
  mon: { closed: boolean, open: string, close: string },
  tue: { ... },
  wed: { ... },
  thu: { ... },
  fri: { ... },
  sat: { ... },
  sun: { ... },
}
```

Keys are **3-letter lowercase day names** (`mon`–`sun`), not integers. The backend must map them to `dayOfWeek` integers (mon=1, tue=2, wed=3, thu=4, fri=5, sat=6, sun=0) when writing to `BusinessHours`.

---

### ApiError — Error Response Must Include `code` Field

The frontend `ApiError` class reads `response.code` alongside `response.message`. Every error response must include both:

```json
{ "error": "snake_case_code", "message": "Human readable in resolved lang" }
```

The frontend switches on `error` (the code) for programmatic handling. `message` is shown in toasts. Missing `error` field causes the error to be silently swallowed as an unknown error.

---

## Authoritative References

Before implementing any feature, read the relevant section in `BLUEPRINT.md`:

| Feature               | Blueprint Section |
| --------------------- | ----------------- |
| Auth + OTP + Invites  | §1                |
| Shops Discovery       | §2                |
| Shop Detail           | §3                |
| Barber Profile        | §4                |
| Booking Wizard        | §5                |
| Checkout + Payments   | §6                |
| Queue                 | §7                |
| Booking History       | §8                |
| Hair Analysis         | §9                |
| Contact Form          | §10               |
| Dashboard Analytics   | §11               |
| Notifications         | §12               |
| Onboarding Wizard     | §13               |
| Marketplace           | §14               |
| Platform Settings     | §15               |
| Subscription Plans    | §16               |
| Discount System       | §17               |
| Mock → API mapping    | §18               |
| Loyalty System        | §19               |
| Reliability / No-Show | §20               |
| VIP Customers         | §21               |
| PWA / Offline Sync    | §22               |
| Shop Load / Heatmap   | §23               |
