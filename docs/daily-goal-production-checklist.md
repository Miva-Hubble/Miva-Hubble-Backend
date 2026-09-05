# Daily Goal / Student Resource Progression — Production Release Checklist

This checklist governs shipping the student resource progression feature
(`StudentResource` → `DailyGoal` → `ResourceContribution` → `RankDefinition`
→ `UserProgression`) to production. It is intentionally sequential — items
are ordered so that each one is safe to do only once the ones above it are
done. Do not skip ahead.

Related reading: `daily-goal-architecture.md` (business rules),
`architecture-overview.md` §8.7/§9.6/§10/§18.3 (data flow, API contracts,
data model, deployment order), `README.md` "Student Resource Progression"
(practical quick-start).

---

## 0. Before touching production at all

- [ ] **Review `git diff`** against the currently-deployed production branch,
      end to end. Confirm the diff contains only what this release is
      supposed to contain — no stray debug code, no commented-out blocks left
      in, no unrelated schema changes riding along.
- [ ] **Confirm no `.env*` files or Supabase credentials are committed.**
      Run `git status` and `git log --all --full-history -- .env .env.*` (or
      equivalent) to confirm none of `.env`, `.env.development`,
      `.env.production`, `.env.production.bak` were ever committed. `.env` is
      already in `.gitignore` — verify that hasn't regressed, and that
      `.env.production.bak` in particular (a literal backup file sitting in
      the repo root) is not staged.
- [ ] **Deploy to development/staging first**, not production. Every step
      below (migration, seed, bucket, manual verification) must be proven out
      on a non-production database before it touches production data.
- [ ] **Run migration status on staging** (`npx prisma migrate status`)
      before applying anything, and again after, to confirm the applied
      migration set matches exactly what's expected — no drift, no
      out-of-band manual changes to the staging schema.
- [ ] **Manually verify the entire flow on staging** using §5 of this
      checklist (student upload → admin approval → progress verification)
      before repeating any of it against production.

---

## 1. Production backup

- [ ] Take a full production database backup (Supabase's built-in
      point-in-time-recovery / scheduled backup, or a manual `pg_dump`)
      immediately before running the migration in §3. Confirm the backup is
      restorable, not just that it completed — a backup nobody has tested a
      restore from is not a backup.
- [ ] Record the backup's timestamp/identifier somewhere the on-call person
      doing this release can find it during a rollback (see §8).

## 2. Production storage bucket

- [ ] Create the `SUPABASE_STUDENT_RESOURCES_BUCKET` bucket (default name
      `student-resources`) in the **production** Supabase project's dashboard.
      There is no code path that creates this bucket — it must exist before
      the app is deployed, or `StudentResourceService.createUploadUrl` fails
      at runtime on the first request.
- [ ] Set the bucket to **private** (not public). All access must go through
      signed URLs the backend issues, matching the existing `resources` and
      `profile-images` buckets.
- [ ] Set a **50 MB** max file size restriction at the bucket level, matching
      `MAX_UPLOAD_SIZE_BYTES` in `src/schemas/storage.schema.ts`. This is a
      second, independent enforcement point — the backend also checks this
      server-side against the physical `storage.objects` metadata in
      `StudentResourceService.createDraft` — but the bucket-level restriction
      must be set regardless; don't rely on application code alone.
- [ ] Set a **MIME type allowlist** at the bucket level matching
      `ALLOWED_UPLOAD_MIME_TYPES` in `src/schemas/storage.schema.ts`:
      `application/pdf`, EPUB, DOC, DOCX (confirm the exact MIME strings
      against that file — don't guess them here).

## 3. Production secrets configured

- [ ] `SUPABASE_STUDENT_RESOURCES_BUCKET` is set explicitly in the production
      environment (it has a code-level default of `"student-resources"`, but
      production should never rely on an implicit default for a bucket name).
- [ ] Every variable in `src/index.ts`'s `REQUIRED_ENV_VARS` fail-fast list is
      confirmed set in production (this should already be true from prior
      releases, but re-verify — the server crashes on boot with a clear error
      if any are missing, so this is a fast check, not a guess).
- [ ] `DATABASE_URL` / `DIRECT_URL` (whichever `prisma.config.ts` resolves to
      for this deploy) point at the **production** database, not staging —
      double-check this explicitly given how easy it is to carry a staging
      connection string forward by copy-paste.

## 4. Database migration — CI/CD only

- [ ] `npx prisma migrate deploy` for
      `prisma/migrations/20260902120000_add_student_resource_progression`
      is run **only** through the CI/CD pipeline against production — never
      manually from a developer's machine, and never via `prisma migrate dev`
      (which is a local-iteration command, not a deploy command).
- [ ] Confirm the pipeline step that runs this migration has no way to also
      run `prisma db seed`, `prisma migrate reset`, or anything destructive —
      `migrate deploy` is additive-only and does not need those permissions.
- [ ] After the pipeline reports success, run `npx prisma migrate status`
      against production directly (read-only check) to independently confirm
      the migration is marked applied — don't only trust the pipeline log.

## 5. Rank seed — run once

- [ ] Run `scripts/seed-rank-definitions.ts` against **production**, once,
      after the migration in §4 and before the application deploy in §6.
      This is not wired to a `pnpm seed:ranks` npm script pointed at
      production on purpose (that script is hardcoded to
      `.env.development`) — run it deliberately, e.g.
      `dotenv -e .env.production -- tsx scripts/seed-rank-definitions.ts`,
      with `.env.production` confirmed to hold production credentials first.
- [ ] Confirm the run's own output reports exactly ten `rank_definitions`
      rows (the script itself fails loudly and refuses to commit if the
      count is ever wrong — treat any failure here as a hard stop, not a
      retry-and-hope).
- [ ] This step must complete successfully before §6 — deploying the
      application before ranks are seeded means the very first resource
      approval will throw (`ProgressionService.recalculateUserProgression`
      has no fallback rank).
- [ ] Confirm this step is **idempotent by design** (upserts by `level`) but
      is still only intentionally run once per release — re-running it
      unnecessarily is harmless, but it's not a step to loop into a retry
      script without understanding why it failed first.

## 6. Deploy & post-deploy health check

- [ ] Deploy the application build containing the Gate 6–10 student resource
      progression code (upload/submit/progress endpoints, admin
      review/archive endpoints, admin progression reporting endpoints).
- [ ] Hit `GET /health` and confirm `200 OK` with
      `{ "status": "ok", "service": "Miva Hubble API" }`.
- [ ] Confirm the process did **not** crash on boot — check logs for the
      `REQUIRED_ENV_VARS` fail-fast exit (`process.exit(1)`) or any
      Supabase-client "not initialized" proxy errors from
      `src/config/supabase.ts`.
- [ ] As an admin, call `GET /api/admin/student-resources` (empty queue is
      fine) and `GET /api/admin/progression` (empty roster is fine) to
      confirm both new admin routers are actually mounted and reachable,
      not just that the process is up.

## 7. Manual end-to-end verification (production)

Do this against production with a real or disposable test account — a
health check alone does not prove the accounting transaction works.

- [ ] **Student upload**: as a real student account, request an upload URL
      (`POST /api/student-resources/upload-url`), upload a small PDF, and
      register it (`POST /api/student-resources`). Confirm the resource is
      created with `status: "DRAFT"`.
- [ ] **Student submit**: submit it (`POST /api/student-resources/:id/submit`).
      Confirm `status: "PENDING_REVIEW"` and `submittedAt` is set.
- [ ] **Admin approval**: as an admin, list the review queue
      (`GET /api/admin/student-resources?status=PENDING_REVIEW`), confirm the
      resource appears, then approve it
      (`PATCH /api/admin/student-resources/:id/review { "action": "APPROVE" }`).
      Confirm the response shows `status: "APPROVED"`, `approvedAt`, and
      `reviewedByAdminId` set.
- [ ] **Progress verification**: as the same student, call
      `GET /api/student-resources/progress`. Confirm `dailyGoal.activeCount`
      is `1`, `dailyGoal.percentage` is `33`, and `rank.approvedResourceCount`
      is `1`. This is the step that proves the full transaction chain
      (status update → `DailyGoal` upsert → `ResourceContribution` create →
      `UserProgression` recalculation) actually ran correctly against the
      real production database, not just that individual endpoints respond.
- [ ] **Archive/revoke check**: archive that same resource
      (`PATCH /api/admin/student-resources/:id/archive`), then re-check the
      student's progress. Confirm `dailyGoal.activeCount` drops back to `0`
      and `rank.approvedResourceCount` drops back to `0` — this proves
      revocation recalculation, not just approval, works end to end.
- [ ] Clean up the disposable test account/resource created for this
      verification, or clearly label it as a permanent smoke-test fixture if
      your team intends to reuse it for future releases.

## 8. Rollback plan

If any step above fails, or a problem is discovered shortly after release:

- [ ] **Disable the new routes, not the whole release**, if only this
      feature is misbehaving: the student-resource and progression routers
      (`/api/student-resources`, and the `student-resources`/`progression`
      routes mounted in `routes/admin.ts`) can be pulled from `src/index.ts`
      / `src/routes/admin.ts` and redeployed independently of the rest of the
      application, which has no dependency on this feature.
- [ ] If the whole release needs to be rolled back, redeploy the previous
      known-good build. The migration in §4 is purely additive (new enums,
      new tables, no `ALTER` on any pre-existing table — see the migration
      file's own header comment) — rolling back the application code does
      **not** require rolling back the migration, and the five new tables
      being present-but-unused is harmless.
- [ ] **Never delete `ResourceContribution` rows** as part of any rollback
      or incident response, under any circumstance — they are the immutable
      accounting ledger this entire feature is built to protect (see
      `daily-goal-architecture.md` §5/§6 and `architecture-overview.md`
      §8.7/§10.2). If a contribution needs to stop counting, the only
      sanctioned action is the existing archive/revoke path
      (`PATCH /api/admin/student-resources/:id/archive`), which sets
      `revokedAt`/`revocationReason` and triggers a full progression
      recalculation — never a manual `DELETE`, and never manually flipping
      `revokedAt` outside that endpoint's transaction.
- [ ] If `UserProgression` state looks wrong for a specific user after an
      incident, use `pnpm reconcile:progression:dry-run -- <userId>` first
      (report-only, writes nothing) to see what a full recalculation would
      produce, and only then `pnpm reconcile:progression -- <userId>` to
      actually rebuild that one user's snapshot from their
      `ResourceContribution` ledger. Never hand-edit a `UserProgression` row
      directly — it must always be a derived value.
- [ ] Restore from the backup taken in §1 only as a last resort (data
      corruption beyond what reconciliation can fix) — it is the most
      disruptive option on this list and should not be reached for first.
