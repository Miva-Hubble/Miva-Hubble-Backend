# Gate 12 — Vault Publication Design

**Status: IMPLEMENTED — awaiting migration deployment and end-to-end verification.**

This changes the product contract established in
`docs/resource-submission-domain-contract.md` (frontend repo) — that
document said a submission "only becomes discoverable... if/when a
separate, not-yet-implemented publishing step exists." This *is* that step.
The contract doc will need a follow-up amendment once this ships (see
§7).

## 1. What actually needs to change

Nothing in the data model. Approval already flips `status` to `APPROVED`.
"Published into the Vault" doesn't need a new column, a new table, or a
new boolean flag — it is **defined as** `status = APPROVED`, exactly the
same way `Book.status = PUBLISHED` already defines Vault visibility for
admin-curated books. This mirrors `StorageService.getPersonalizedFeed`
almost exactly.

**Consequence that falls out for free:** "archiving removes the resource
from the Vault" needs **zero new code**. `archiveResource()` (already
shipped in the previous change) sets `status = ARCHIVED`; the new Vault
query below only ever selects `status = APPROVED`. An archived resource
disappears from the Vault the instant its status changes, with no
additional logic. Same for revoking the progression contribution — already
implemented, unchanged by this gate.

So Gate 12 is entirely new **read surface** (two GET endpoints) plus one
list endpoint for the student's own resources. `reviewResource()`'s
`APPROVE` branch does not need to change at all — it already does
everything "publication" requires by setting `status = APPROVED`.

## 2. The one non-negotiable rule

**Eligibility (`level`, `department`) is derived server-side from the
authenticated student's own `Onboarding` row, on every single request. It
is never accepted from a query param, body, or any client input, under any
circumstance.**

This mirrors the existing rule on `GET /api/student-resources/progress`
("userId always comes from the token, never a param") and
`getPersonalizedFeed` (reads `onboarding.level`/`onboarding.department`
straight from the DB, never from the request). A student sending
`?level=Level400` must never be able to see Level400 content if their own
onboarding says Level100. This is the entire security model for the new
`/api/vault` surface — everything else is a filter *on top of* this, never
a substitute for it.

If a student has no `Onboarding` row yet: return an empty result set (`[]`
+ zero-page pagination), the same graceful-empty behavior
`getPersonalizedFeed` already has. Not an error — a student who hasn't
onboarded yet just sees nothing, same as the existing library feed.

## 3. New endpoints

### `GET /api/vault` — student-facing discovery

Auth: `authenticate` (student token) only. Never admin-accessible through
this route — admins already have full unfiltered visibility via
`GET /api/admin/student-resources`.

Query params (all optional, all *filters on top of* the mandatory
level/department match — never a replacement for it):
- `courseCode` — exact match
- `resourceType` — one of the four enum values
- `search` — ILIKE across `title`, `courseTitle`, `courseCode`,
  `description`, escaped the same way
  `ProgressionService.listUserProgression`'s search already escapes `%`,
  `_`, `\` — that escaping is mandatory here too, not optional, since it's
  the established pattern for any ILIKE built from user input in this
  codebase.
- `page` / `limit` — same shape as the admin list endpoint (default 1/20,
  max 100)

Base `where` clause (always applied, never overridable by any param):
```
status: APPROVED
level: onboarding.level        // exact match — see §4 on why not wildcard
department: onboarding.department
```

Response: `{ success, resources: PublicStudentResourceDto[], pagination }`
— every resource passed through the existing
`StudentResourceService.toPublicResource` (no `storagePath`, ever).

Sort: `approvedAt desc` — "publication date," not `createdAt` (which is
draft-creation time and can predate approval by days).

### `GET /api/vault/:id/url` — signed access

Auth: `authenticate` (student token).

Steps:
1. Look up the resource by `id`.
2. Re-derive the caller's `onboarding.level`/`department` fresh from the
   DB (never trust anything cached from step-1's lookup or from the
   request).
3. Verify **all three**: `status === APPROVED`, `resource.level ===
   onboarding.level`, `resource.department === onboarding.department`.
4. Any failure → **404**, not 403 — matching the existing convention on
   `GET /api/notifications/:id` ("404s rather than 403s on mismatch") so an
   ineligible student can't distinguish "doesn't exist" from "exists but
   isn't yours to see."
5. Resolve the physical storage location via `storageObjectId` (same
   `resolveObjectLocation`-style lookup `StorageService` already has —
   duplicated into `StudentResourceService`, matching the existing
   precedent that these two services already don't share private helpers).
6. `supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttl, mode ===
   "download" ? { download: true } : undefined)` — same TTLs as
   `StorageService` (300s preview / 120s download) for consistency.

Response: `{ success, signedUrl }`. Never `storagePath`, never
`storageObjectId`.

**Explicitly out of scope for this gate:** view/download counters
(`BookView`/`BookDownload`-equivalent dedup tables for student resources).
`StudentResource` has no `previewCount`/`downloadCount` columns and
nothing in this request asked for them. If wanted later, that's its own
gate — don't let it sneak in as a "since we're already touching signed
URLs" add-on.

### `GET /api/student-resources/mine` — student's own submissions

Auth: `authenticate`. `userId` from the token only, exactly like
`/progress` — no param, no way to query someone else's submissions.

Ownership-based, **not** eligibility-filtered — unlike `/api/vault`, this
returns the caller's own resources in **every** status: `DRAFT`,
`PENDING_REVIEW`, `APPROVED`, `REJECTED` (with `rejectionReason`), and
`ARCHIVED`. That's the whole point of the endpoint — a student needs to see
their own rejected/draft work, which by definition never appears in
`/api/vault`.

Optional `?status=` filter (same enum, for a tabbed UI: Draft / Pending /
Approved / Rejected / Archived). Simple `findMany`, ordered `createdAt
desc` — no pagination edge cases expected given the existing 6-per-day
submission cap keeps any one student's total volume small.

Response: same `PublicStudentResourceDto` shape as above, through
`toPublicResource`.

## 4. Why exact equality, not wildcard

`Book.level`/`Book.department` support a `TARGETING_WILDCARD` ("All")
because an *admin* curates those values deliberately for broad targeting.
`StudentResource.level`/`department` are picked by the student from the
same fixed taxonomy dropdown their own onboarding used (`useTaxonomy` /
`taxonomy.route.ts`) — there's no "All" concept in that picker, and the
spec is explicit: `Resource.level == student.onboarding.level AND
Resource.department == student.onboarding.department`. So: exact equality,
both sides, no wildcard, no case-insensitivity carve-out either (unlike
`getPersonalizedFeed`'s department match, which is case-insensitive
because admins type free text — students select from the same canonical
list, so a case mismatch would itself be a bug worth surfacing, not
silently tolerating).

## 5. Non-goals (explicit, to prevent scope creep)

- **Do not** create `Book` rows from approved `StudentResource` rows.
  `Book` stays admin-curated only, completely untouched by this gate.
- **Do not** add preview/download counters for student resources.
- **Do not** add wildcard/"All" targeting for student submissions.
- **Do not** expose `/api/vault` to admin tokens — admins already have
  `GET /api/admin/student-resources` for full visibility across every
  status and every level/department.
- **Do not** change `reviewResource()` — it already does everything
  "publication" requires.

## 6. Testing

Gate 12 has its own `test:gate12` script
(`scripts/test-gate12-vault-e2e.ts`), following the exact pattern of
`test:gate6`–`test:gate10`, and should be appended to the
`test:daily-goal` chain:
```
"test:daily-goal": "pnpm test:gate6 && pnpm test:gate7 && pnpm test:gate8 && pnpm test:gate9 && pnpm test:gate10 && pnpm test:gate12"
```
Minimum coverage: a student sees only same-level/department APPROVED
resources; a student cannot see another level/department's resources even
by guessing an id (`/url` returns 404); an archived-after-approval resource
disappears from `/api/vault` and its contribution is revoked; `/mine`
returns all five statuses including `rejectionReason` on rejected items;
search-string ILIKE-metacharacter injection doesn't widen results.

## 7. Frontend follow-up (not started, flagging only)

`docs/resource-submission-domain-contract.md` §1 says submissions and
library `Book`s "must never be merged, compared, or rendered through
shared components that assume identical shapes." That rule still holds at
the *code* level even though this gate makes them **visually** coexist in
the same Vault screen for the first time. That means: two source types,
two DTOs, two service calls, likely two sections/tabs in the UI — not one
unified list secretly branching on shape. This needs its own short design
pass once the backend above is approved and built; not doing it
speculatively here.

---

Awaiting sign-off before writing any migration, route, controller, or
service code for this gate.
