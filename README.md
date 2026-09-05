# Miva Hubble Backend

Backend API for **Miva Hubble** — the student resource and academic digital
locker platform for Miva Open University. Handles student/admin
authentication, academic onboarding, client-direct file storage against
Supabase, a personalized library feed, and an admin-driven email
notification/campaign engine.

For the full system design (C4 diagrams, sequence diagrams, complete API
contracts, data flow, and security model) see
[`architecture-overview.md`](./architecture-overview.md) — this README is a
practical quick-start; that document is the source of truth for architecture.

## Tech Stack

- **Node.js** + **Express** + **TypeScript** (ESM, `NodeNext` module resolution)
- **PostgreSQL** via **Prisma ORM** (`@prisma/adapter-pg`, driver adapters)
- **Supabase** — Postgres hosting + S3-compatible Storage (client-direct upload/download via signed URLs)
- **Google OAuth 2.0** (`googleapis`) — manual authorization-code flow, restricted to `@miva.edu.ng`
- **BullMQ** + **Redis** (Upstash) — background job queue for notification delivery
- **Resend** — transactional email provider for admin notification campaigns
- **Nodemailer** — SMTP transport for OTP / password-reset emails (separate from Resend — see [Email delivery](#email-delivery) below)
- **Zod** — request validation schemas
- **bcrypt** — password hashing (12 rounds)
- **jsonwebtoken** — JWT issuance/verification, with **separate secrets and claim scopes** for student vs. admin tokens
- **multer** — in-memory multipart parsing for profile picture uploads
- **sanitize-html** — HTML sanitization on admin-authored notification bodies

> Note: `passport`, `passport-google-oauth20`, and `passport-jwt` are present
> in `package.json` but are not wired into any route — the app uses the
> manual `googleapis` OAuth2 flow instead. Safe to remove if you don't plan
> to use Passport strategies.

## Features

- **Student auth**: Google SSO (domain-restricted to `@miva.edu.ng`) and email/password with OTP email verification
- **Password reset**: OTP-based, with email-enumeration protection (always returns a generic success message)
- **Academic onboarding**: level, department, goals, preferred mode, optional profile picture — one-time, 1:1 with the user
- **Admin portal**: separate JWT secrets/claims from student auth, brute-force lockout (5 attempts → 15 min lock), DB-backed session revocation, full login audit trail
- **Client-direct file storage**: signed upload/download URLs against Supabase Storage — the Node server never proxies file bytes
- **Personalized library feed**: admin-curated books matched to a student's level/department/goals
- **Notification engine**: admin-only bulk email campaigns targeted by level/department, processed asynchronously via BullMQ + Resend, with a full per-recipient delivery audit trail
- **Student resource progression**: students submit academic resources (notes, past questions, study guides, references) for admin review; approved resources feed a daily-goal/streak/consistency/rank system evaluated on the `Africa/Lagos` calendar day. See [Student Resource Progression](#student-resource-progression) below and `architecture-overview.md` §8.7/§9.6 for the full lifecycle, rules, and API contracts.

## Setup

### 1. Install dependencies

```bash
npm install
# or: pnpm install
```

### 2. Database

This project targets a Postgres instance reachable via `DATABASE_URL` —
in practice a Supabase project (the app also depends on Supabase Storage and
Supabase's `storage.objects` schema for file registration, so a plain local
Postgres won't cover the storage features end-to-end). Point `DATABASE_URL`
at your own Supabase project's pooled connection string (Supavisor, port
`6543`), or any Postgres instance if you only need the auth/onboarding
features.

There is currently no `docker-compose.yml` in this repo for a local
Postgres — if you want one for pure-auth local development, add one
pointing at a `postgres:16` image and wire `DATABASE_URL` to it.

### 3. Environment Variables

```bash
cp .env.example .env
```

`.env.example` documents every variable in detail. The important groups:

```env
PORT=7292
DATABASE_URL=postgresql://...                 # Supabase pooled connection (port 6543)

# Student JWT secrets
ACCESS_TOKEN_SECRET=...
REFRESH_TOKEN_SECRET=...

# Admin JWT secrets — deliberately separate from student secrets, so a
# leaked/forged student token can never be replayed against admin routes.
ADMIN_ACCESS_TOKEN_SECRET=...
ADMIN_REFRESH_TOKEN_SECRET=...

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:7292/api/auth/google/callback

# Frontend
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000

# Supabase Storage
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...                  # server-side only — bypasses RLS
SUPABASE_STORAGE_BUCKET=resources
SUPABASE_PROFILE_IMAGES_BUCKET=profile-images
SUPABASE_STUDENT_RESOURCES_BUCKET=student-resources   # defaults to "student-resources" if unset — see below

# Notification engine (BullMQ + Resend)
UPSTASH_REDIS_URL=rediss://...                 # must be rediss:// (TLS) for Upstash
RESEND_API_KEY=...
RESEND_FROM_EMAIL=Miva Hubble <noreply@miva.edu.ng>
DISABLE_NOTIFICATION_WORKER=false              # set true to run without a worker (e.g. local testing without Redis)

# OTP / password-reset email delivery (see "Email delivery" below)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

In `NODE_ENV=production`, the server fails fast at startup (`process.exit(1)`)
if any of `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`FRONTEND_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
`ADMIN_ACCESS_TOKEN_SECRET`, `ADMIN_REFRESH_TOKEN_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
`SUPABASE_PROFILE_IMAGES_BUCKET`, `UPSTASH_REDIS_URL`, `RESEND_API_KEY`, or a
Google redirect URI is missing. See `src/index.ts`.

> `SUPABASE_STUDENT_RESOURCES_BUCKET` is **not** in that fail-fast list — it
> defaults to `"student-resources"` in `StudentResourceService` if unset. Set
> it explicitly in production so the bucket name is never accidentally
> implicit. The bucket itself must be created and configured in the Supabase
> dashboard before first use — see [Student Resource Progression](#student-resource-progression) below.

### 4. Database Migrations

```bash
npx prisma migrate deploy   # apply committed migrations
npx prisma generate         # regenerate the Prisma client into src/generated/prisma
```

Do not run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` in
this project: the two-project Supabase setup has no isolated shadow
database. Create reviewed SQL migrations manually, apply them to
development with `prisma migrate deploy`, then deploy the unchanged
migration through CI/CD.

> **Migration order matters for the student resource progression feature.**
> `20260902120000_add_student_resource_progression` creates the
> `StudentResourceStatus`/`StudentResourceType` enums and the five new
> tables (`student_resources`, `daily_goals`, `resource_contributions`,
> `rank_definitions`, `user_progressions`) but seeds **no rows**. Always run
> the migration, *then* seed ranks (step 6), *then* deploy/start the app —
> `ProgressionService.recalculateUserProgression` throws if it can't find a
> matching `RankDefinition` row, so deploying the app before seeding ranks
> will fail the first resource approval.

### 5. Seed an admin (optional, for testing the admin portal)

```bash
npm run seed:admin
```

### 6. Seed rank definitions (required for student resource progression)

```bash
pnpm seed:ranks
```

Upserts the ten fixed ranks (Novice → Ultimate) into `rank_definitions`,
keyed by `level` so it's safe to rerun. See
`scripts/seed-rank-definitions.ts`. Must run after migrations and before
any resource is approved. `pnpm seed:ranks` is wired to
`dotenv -e .env.development`, so it always targets the development database
regardless of what `.env` currently points to.

## Email delivery

There are **two separate email paths** in this codebase — don't assume one
covers the other:

| Path | Trigger | Transport | Config |
| :--- | :--- | :--- | :--- |
| **OTP / password reset** | `MailService` (`src/services/mailService.ts`), called from `authController` | Nodemailer over SMTP | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` |
| **Admin notification campaigns** | `notification.worker.ts` via `ResendProvider` | Resend API | `RESEND_API_KEY` / `RESEND_FROM_EMAIL` |

`.env.example` labels the SMTP block "legacy — kept for reference only,
replaced by Resend for notifications." That's only true for the
**notification campaign** path. `MailService` (registration OTPs, login OTPs,
password-reset OTPs, and the "password reset successful" confirmation) still
sends through SMTP/Nodemailer and has **not** been migrated to Resend. If you
leave `SMTP_*` unset, OTP and password-reset emails will fail at runtime,
even with Resend fully configured.

## Development

```bash
npm run dev
```

Server runs on `http://localhost:7292` (or `PORT`).

Useful scripts:

```bash
npm run check:onboarding   # scripts/check-onboarding-api.mjs — sanity-checks onboarding endpoints
npm run test:onboarding    # scripts/test-onboarding-live.mjs — live onboarding flow test
npm run seed:admin         # scripts/seed-admin.mjs — creates an Admin row for local/staging testing
pnpm seed:ranks            # scripts/seed-rank-definitions.ts — upserts the 10 fixed ranks (dev-only, see above)
pnpm test:gate6            # scripts/test-student-resources-e2e.ts — draft/submit lifecycle + submission rate limit
pnpm test:gate7            # scripts/test-gate7-e2e.ts — admin review/approve/reject/archive + accounting transaction
pnpm test:gate8            # scripts/test-gate8-progression.ts — daily goal / streak / rank recalculation
pnpm test:gate9            # scripts/test-gate9-progress-endpoint.ts — student's own GET /progress endpoint
pnpm test:gate10           # scripts/test-gate10-admin-progression-e2e.ts — admin progression reporting endpoints
pnpm reconcile:progression -- <userId>            # scripts/reconcile-user-progression.ts — rebuilds one user's UserProgression from their contribution ledger
pnpm reconcile:progression:dry-run -- <userId>    # same, report-only, writes nothing
```

All `test:gate*` and `reconcile:progression*` scripts are wired to
`dotenv -e .env.development` and must never be pointed at production.

## Production

```bash
npm run build   # prisma generate && tsc
npm start       # node dist/index.js
```

## Project Structure

```
src/
├── config/                    # Redis + Supabase client setup
├── controller/                # Student/admin/storage/onboarding/profile-picture request handlers
├── events/                    # In-process EventEmitter (e.g. user.onboarded)
├── middleware/                # authenticate, authenticateAdmin, validate, upload (multer), error handler
├── modules/
│   └── notifications/         # Self-contained module: controller/service/repository/queue/worker/validation
├── providers/
│   └── email/                 # IEmailProvider interface + Resend implementation
├── routes/                    # Express routers, one per domain
├── schemas/                   # Zod request-validation schemas
├── services/                  # Business logic (auth, admin auth, storage, onboarding, OTP, mail, user, student resources, progression)
├── lib/
│   ├── prisma.ts              # Prisma client singleton (pg driver adapter)
│   └── lagosTime.ts           # Africa/Lagos calendar-day helpers shared by studentResourceService + progressionService
└── types/                     # Local type augmentations
prisma/
├── schema.prisma
└── migrations/
```

## API Overview

All endpoints return JSON. See `architecture-overview.md` §9 for full request/response schemas, and the Postman collections under `postman/` and `.postman/` for ready-to-run requests.

### Student Auth — `/api/auth`

| Method | Path | Auth | Notes |
| :--- | :--- | :--- | :--- |
| GET | `/google` | — | Returns Google consent URL |
| GET | `/google/callback` | — | OAuth redirect target; sets cookies, redirects to frontend |
| GET | `/google/callback-popup` | — | Popup-window variant; `postMessage`s tokens to opener |
| POST | `/google/token` | — | Manual code exchange (frontend handles the redirect itself) |
| POST | `/register` | — | Email/password registration; sends verification OTP |
| POST | `/login` | — | Email/password login |
| POST | `/verify-email` | — | Verifies registration OTP |
| POST | `/forgot-password` | — | Always returns generic success (anti-enumeration) |
| POST | `/verify-otp` | — | Verifies password-reset OTP, returns a reset token |
| POST | `/reset-password` | — | Completes password reset |
| POST | `/refresh` | Cookie: `refreshToken` | Rotates access + refresh tokens |
| GET | `/debug/token` | dev-only | Gated by `devOnly` middleware; disabled in prod unless `ENABLE_DEBUG_TOKEN=true` |

### Student Profile & Onboarding

| Method | Path | Auth |
| :--- | :--- | :--- |
| GET | `/api/user/me` | Student token |
| POST | `/api/onboarding/profile-picture` | Student token, `multipart/form-data` |
| POST | `/api/onboarding` | Student token |

### Storage & Library — `/api/storage`

| Method | Path | Auth |
| :--- | :--- | :--- |
| POST | `/upload-url` | Student token |
| POST | `/` | Student token — registers a completed upload |
| GET | `/` | Student token — lists own files |
| GET | `/library` | Student token — personalized feed |
| GET | `/:id/url` | Student token — signed download URL (`?isBook=true` for library books) |
| DELETE | `/:id` | Student token — soft-archive |

### Student Resource Progression — `/api/student-resources` (student-facing)

| Method | Path | Auth | Notes |
| :--- | :--- | :--- | :--- |
| POST | `/upload-url` | Student token | Signed Supabase upload URL under `student-resources/{userId}/` |
| POST | `/` | Student token | Registers a completed upload as a `DRAFT` resource; fail-closed verification against `storage.objects` metadata |
| POST | `/:id/submit` | Student token | `DRAFT` → `PENDING_REVIEW`; enforces the 6-submissions-per-`Africa/Lagos`-day cap |
| GET | `/progress` | Student token | Own daily goal / streak / consistency / rank snapshot — userId always comes from the token, never a param |

### Admin — `/api/admin`

| Method | Path | Auth |
| :--- | :--- | :--- |
| POST | `/auth/login` | — |
| POST | `/auth/refresh` | Cookie: `adminRefreshToken` |
| POST | `/auth/logout` | — |
| GET | `/auth/me` | Admin token |
| POST | `/storage/books/upload-url` | Admin token |
| POST | `/storage/books` | Admin token |
| GET | `/storage/books` | Admin token |
| PATCH | `/storage/books/:id` | Admin token |
| DELETE | `/storage/books/:id` | Admin token |
| POST | `/notifications/send` | Admin token, rate-limited (10/min/IP) — dispatches a bulk campaign by level/department |
| GET | `/student-resources` | Admin token — review queue; `?status=PENDING_REVIEW`, `?page=`, `?limit=` (max 100) |
| PATCH | `/student-resources/:id/review` | Admin token — `{ action: "APPROVE" \| "REJECT", reason? }`; only `PENDING_REVIEW` resources; `reason` required for `REJECT`; approval runs the full accounting chain in one serializable transaction |
| PATCH | `/student-resources/:id/archive` | Admin token — `{ reason? }`; only `APPROVED` resources; revokes (never deletes) the `ResourceContribution`, then recalculates progression |
| GET | `/users/:userId/progression` | Admin token — one user's full progression report + last 7 Lagos-day records |
| GET | `/progression` | Admin token — paginated roster of every user's progression; `?rankLevel=`, `?search=`, `?page=`, `?limit=` |

### Notifications — `/api/notifications` (student-facing, read-only)

| Method | Path | Auth |
| :--- | :--- | :--- |
| GET | `/user/me` | Student token — own received notifications |
| GET | `/:id` | Student token — single notification status (ownership-checked, 404s rather than 403s on mismatch) |

## Frontend Integration — Google OAuth

The manual OAuth flow (`GET /api/auth/google` → redirect to Google → `GET /api/auth/google/callback`) is the primary path; it sets `accessToken`/`refreshToken` as `HttpOnly` cookies and redirects to `${FRONTEND_URL}/auth-callback?success=true&isNewUser=...&isOnboarded=...`.

If you'd rather handle the Google redirect yourself on the frontend and exchange the code manually:

```ts
const response = await fetch("http://localhost:7292/api/auth/google/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify({ code: authorizationCodeFromGoogle }),
});
const data = await response.json();
```

## Student Resource Progression

Full design rationale lives in `daily-goal-architecture.md`; full API contracts,
sequence diagrams, and data model live in `architecture-overview.md` §8.7/§9.6/§10.
This section is the practical summary.

### Lifecycle

```
DRAFT → PENDING_REVIEW → APPROVED → ARCHIVED
                       → REJECTED
```

- **DRAFT**: created by `POST /api/student-resources` after a verified upload. Does not count toward anything yet.
- **PENDING_REVIEW**: student calls `POST /api/student-resources/:id/submit`. Capped at **6 submissions per `Africa/Lagos` calendar day per student**, enforced server-side inside a serializable transaction.
- **APPROVED**: admin-only (`PATCH /api/admin/student-resources/:id/review` with `action: "APPROVE"`). Only a `PENDING_REVIEW` resource can be approved. Approval is one serializable transaction that (1) marks the resource `APPROVED`, (2) stamps `reviewedByAdminId`/`reviewedAt`/`approvedAt`, (3) computes the resource's `Africa/Lagos` activity date, (4) upserts that day's `DailyGoal`, (5) creates exactly one `ResourceContribution` (unique per resource — a duplicate approval can never create a second one), and (6) recalculates `UserProgression`.
- **REJECTED**: admin-only, same endpoint with `action: "REJECT"`. `reason` is **required**. Only a `PENDING_REVIEW` resource can be rejected. No accounting side effects.
- **ARCHIVED**: admin-only (`PATCH /api/admin/student-resources/:id/archive`). Only a currently `APPROVED` resource can be archived. This **revokes, never deletes**, the resource's `ResourceContribution` (`revokedAt`/`revocationReason`), then recalculates the affected day, streak, lifetime approved count, and rank from what remains active.

### Daily goal, streak, consistency, rank

- **Daily goal**: 3 active (non-revoked) approved-resource contributions per `Africa/Lagos` calendar day. Display percentage is a fixed lookup (`0 → 0%`, `1 → 33%`, `2 → 66%`, `3+ → 100%`), never a raw division, and never exceeds 100%.
- **Streak**: consecutive `Africa/Lagos` calendar days with a completed daily goal. Broken by any day that isn't complete; `currentStreak` only counts as "live" if the most recent completed day is today or yesterday.
- **Consistency**: rolling 7-`Africa/Lagos`-day completed-days ÷ eligible-days percentage, recomputed on read (never a stored, driftable value); the denominator never counts days before the account existed.
- **Rank**: ten fixed ranks, one per 10 lifetime approved contributions — Novice(0) / Amateur(10) / Senior(20) / Enthusiast(30) / Professional(40) / Expert(50) / Legend(60) / Veteran(70) / Master(80) / Ultimate(90, terminal). Seeded via `pnpm seed:ranks` (`scripts/seed-rank-definitions.ts`), never hardcoded in application logic.
- Everything above is **derived**, not incremented: `ProgressionService.recalculateUserProgression` always recomputes from the currently-active `ResourceContribution` rows and upserts the result, which is what makes revocation (archive) safe and idempotent.

### Timezone

All daily-goal/streak/consistency/submission-cap calculations use `Africa/Lagos`
(UTC+1, no DST) via `src/lib/lagosTime.ts` — never the server's local timezone.
A resource approved at 23:30 WAT and one approved at 00:05 WAT the next day
resolve to different calendar days, regardless of where the server runs.

### Production storage bucket setup

The `SUPABASE_STUDENT_RESOURCES_BUCKET` bucket (default name `student-resources`)
must be created manually in the Supabase dashboard before first use — there is
no code path that creates it. In production it must be:

1. **Private** (not public) — all access goes through signed URLs the backend issues, matching the `resources` and `profile-images` buckets.
2. Restricted to a **50 MB** max file size (matches `MAX_UPLOAD_SIZE_BYTES` in `src/schemas/storage.schema.ts`, enforced again server-side against the physical `storage.objects` metadata in `StudentResourceService.createDraft` — belt-and-suspenders, not either/or).
3. Restricted to the **PDF / EPUB / DOC / DOCX** MIME types in `ALLOWED_UPLOAD_MIME_TYPES` (`src/schemas/storage.schema.ts`).

See `docs/daily-goal-production-checklist.md` for the full pre-launch checklist.

## License

MIT
