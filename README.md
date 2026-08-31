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

### 4. Database Migrations

```bash
npx prisma migrate deploy   # apply committed migrations
npx prisma generate         # regenerate the Prisma client into src/generated/prisma
```

For local schema iteration: `npx prisma migrate dev`.

### 5. Seed an admin (optional, for testing the admin portal)

```bash
npm run seed:admin
```

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
```

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
├── services/                  # Business logic (auth, admin auth, storage, onboarding, OTP, mail, user)
├── lib/prisma.ts              # Prisma client singleton (pg driver adapter)
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

## License

MIT
