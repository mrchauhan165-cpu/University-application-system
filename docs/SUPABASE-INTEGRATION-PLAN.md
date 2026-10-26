# Supabase integration — audit and implementation plan

Status: **audit complete, no application code changed.**
Scope of this document: what exists today, what is demo-only, which files must
change, and the order in which to connect a real Supabase project without
touching the UI.

---

## 0. Snapshot of the repository

| Item | Value |
| --- | --- |
| Branch audited | `arena/6bc9559c-university-application-system` |
| HEAD | `c0e7082` (merge of PR #6) |
| Stack | React 18 + TypeScript 5 + Vite 5, hash routing, no router/state/UI library |
| Styling | one stylesheet, `src/ui/styles.css` (no Tailwind, no CSS-in-JS) |
| Tests | 12 files, **155 tests**, `vitest` + `@testing-library/react` (jsdom) |
| Typecheck | `tsc --noEmit` clean |
| Build | `tsc -p tsconfig.json --noEmit && vite build` → `dist/` |
| Deploy | GitHub Pages via `.github/workflows/deploy.yml` (push to `main` or manual dispatch) |
| Network calls at runtime | **none** — the app is fully offline after load |

---

## 1. How it works today

```
UI pages (src/ui/pages/**)
   │  read: useApp().data / .session          write: backend.<operation>()
   ▼
src/ui/context.tsx  (React context + hash router + toasts)
   ▼
src/backend/local.ts  ── LocalBackend (the only implementation)
   │   • session + grants (session.ts, authz.ts)
   │   • operations  (ops/applications.ts, ops/admin.ts, ops/notices.ts, ops/retention.ts)
   │   • read model  (select.ts → viewData(): the permission-filtered AppData snapshot)
   ▼
src/backend/store.ts  → window.localStorage  (or memory when storage is blocked)
```

`BackendApi` in `src/backend/local.ts` already declares
`readonly mode: 'demo' | 'supabase'`, but **only the demo implementation exists**.
The whole service layer is synchronous and in-memory; every rule (scope, self
approval, post handover, retention gates) is enforced inside
`src/backend/**` — which is the behaviour a Supabase adapter must reproduce.

---

## 2. Where the data actually lives right now

| Concern | Today | Consequence |
| --- | --- | --- |
| All entities | one JSON blob in `localStorage` key **`uas.v1.state`** (`{ data, auth }`) | per browser, per device; nothing is shared |
| Session pointer | `localStorage` key **`uas.v1.session`** (`userId` + expiry, 12 h) | sign-in does not follow the person to another device |
| Passwords | salted hash in the same blob (`src/backend/crypto.ts`) | demo-only; Supabase Auth replaces it |
| Storage blocked / iframe | falls back to `MemoryPersistence` and shows a banner | demo still works, nothing is saved |
| Size cap | 4.2 MB per origin, checked before write | attachments are base64 strings inside the blob |
| Seed | `src/backend/seed.ts` on first boot: 19 faculties, 45 departments, 4 batches, 5 sections, 6 application types, 6 workflows, 20 profiles, 15 assignments, 8 applications, 4 notices | rich demo, but generated client-side |
| Documents | `documents.inline_data` data URL + `storage_path` (`applications/<applicant>/<app>/<file>`) | path is already Supabase-shaped; bytes are not |
| Notifications | array in the blob | in-app only, no email/push |
| Statistics / CSV | computed in the browser (`select.ts`) | no server aggregation |
| Audit log | append-only array in the blob | immutability is only *guaranteed* by the SQL trigger |
| Export / import | `exportState()` / `importState()` JSON in Administration → Settings | the only way to move data between devices |
| Cloud status | Settings shows "Not connected" | honest, nothing pretends to be synced |

**Short answer: everything is saved in the browser's `localStorage`, on the
device you are using. There is no server, no database and no Supabase project
wired into the code yet.**

---

## 3. Is Supabase already integrated?

**No code is integrated.** What exists is design work:

| Piece | File | State |
| --- | --- | --- |
| Supabase client | — | ❌ not installed (`@supabase/supabase-js` absent) |
| Client instantiation | — | ❌ no `createClient`, no `import.meta.env` usage anywhere |
| Env contract | `.env.example` | ✅ documents `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (not read by code) |
| CI env injection | `.github/workflows/deploy.yml` | ❌ build step passes only `VITE_BASE_PATH` |
| Schema | `supabase/migrations/20260101000000_schema.sql` (467 lines) | ✅ 23 tables, 11 enums, sequences for readable codes/references, `audit_log_immutable` trigger, `touch_updated_at` |
| Row Level Security | `supabase/migrations/20260101000100_rls.sql` (287 lines) | ✅ 27 policies + 6 helper functions (`current_profile_id`, `has_permission`, `scope_covers`, `can_read_application`, `can_read_application_id`, `can_read_notice`) |
| Write path | same file | ❌ **no INSERT/UPDATE policies** — reads are covered, every mutation is expected to go through `security definer` RPCs that do not exist yet |
| Storage | same file | ✅ private bucket `private-documents`, 3 MB limit, MIME allowlist, read policy tied to `documents`, insert restricted to `auth.uid()/…` |
| Seed data for the cloud | — | ❌ no `supabase/seed.sql` |
| `auth.users` ↔ `profiles` | schema (`profiles.id uuid references auth.users(id)`) | ⚠️ FK is right, but no trigger/onboarding flow creates the profile row after sign-up |
| Email (activation, reset) | — | ❌ not configured; demo shows the link on screen |

### Model mismatches to close before writing the adapter

1. **IDs.** Demo ids are readable text (`usr_hod_cse`, `fac_eng`); SQL uses `uuid`
   for org/profile rows and `text` for posts/types/workflows/applications.
   A mapping layer (or a re-seed via SQL) is required.
2. **Profile shape.** TypeScript keeps `home_department_id` for staff and
   `batch_id`/`section_id` for students; the table uses
   `faculty_id/department_id/batch_id/section_id` for everyone.
3. **Settings.** `Settings` has 9 fields; the table has 7 — `seed_data` and
   `allow_self_registration` are missing from SQL. Default `university_name` is
   `'Your University'`, not the university's name.
4. **Derived data.** `session.grants` and the `viewData()` snapshot are computed
   in TypeScript; with Supabase they come from RLS-filtered selects and must
   produce the *same* `AppData` shape so the UI stays untouched.

---

## 4. Features that are demo-only today

Everything below is functional in the browser but **not persistent beyond one
device**, and would be re-implemented against Supabase:

| Area | Pages / modules | Demo behaviour |
| --- | --- | --- |
| Sign-in, lockout, session | `Login.tsx`, `crypto.ts`, `local.ts` | browser hashing, 5-attempt lockout, 12 h session in `localStorage` |
| Invitations / activation / reset | `UsersTab.tsx`, `Login.tsx` | single-use token generated in the browser and **shown on screen** |
| Org structure (faculties → sections) | `StructureTab.tsx` | seeded rows, editable locally |
| People, posts, assignments | `UsersTab.tsx`, `PostsTab.tsx`, `AssignmentsTab.tsx` | same |
| Application types & workflows | `TypesTab.tsx`, `WorkflowsTab.tsx` | versioned locally |
| Applications: draft → submit → act → withdraw | `NewApplication.tsx`, `ApplicationDetail.tsx`, `Applications.tsx`, `Queues.tsx` | all rules enforced in `ops/applications.ts` |
| Documents / attachments | `DocumentViewer.tsx` | base64 inside `localStorage`, 2 MB per file in demo |
| Notices + read receipts | `Notices.tsx`, `ops/notices.ts` | scope filtering in `select.ts` |
| Notifications | `Notifications.tsx`, bell in `Layout.tsx` | in-app rows |
| Statistics + CSV export | `Statistics.tsx`, `computeStats` | computed client-side |
| Audit log | `AuditTab.tsx` | array in the blob (SQL trigger would make it immutable) |
| Retention jobs, legal holds, deletion audits | `RetentionTab.tsx` | simulated locally, nothing is actually destroyed outside the blob |
| Settings, export/import, reset | `SettingsTab.tsx` | JSON download / upload |

Nothing in the UI is a placeholder screen: forms validate, routing works, and
the backend enforces permissions — it is the *storage* that is local.

---

## 5. Files that need to change

### New files

| File | Purpose |
| --- | --- |
| `src/backend/supabase/client.ts` | single `createClient()` using `import.meta.env.VITE_SUPABASE_*`; throws a clear error when unset |
| `src/backend/supabase/backend.ts` | `SupabaseBackend` implementing the same public surface as `LocalBackend` (`signIn`, `getView`, `createDraft`, `submit`, `act`, …) |
| `src/backend/supabase/mappers.ts` | row ⇄ domain mapping (uuid vs readable ids, profile scope fields, settings) |
| `src/backend/api.ts` | shared `AppBackend` interface + factory `createBackend()` (demo vs supabase) |
| `supabase/migrations/20260101000200_rpc.sql` | `security definer` functions for every mutation (see phase 3) |
| `supabase/migrations/20260101000300_settings_columns.sql` | add `seed_data`, `allow_self_registration`, app name/branding columns |
| `supabase/seed.sql` | optional: the 19 faculties/45 departments/6 types/6 workflows + one admin, so a fresh project is usable |
| `src/backend/__tests__/supabase-adapter.test.ts` | contract tests with a mocked client (no network in CI) |

### Existing files to modify (small, additive)

| File | Change | Risk |
| --- | --- | --- |
| `package.json` | add `@supabase/supabase-js` | low |
| `src/main.tsx` | `createBackend()` instead of `new LocalBackend()`; keep local fallback when env is absent | low |
| `src/ui/context.tsx`, `src/App.tsx` | type `backend` as the shared interface instead of `LocalBackend` | low, compiler-checked |
| `.github/workflows/deploy.yml` | pass `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from repository **Variables** to the build step | low |
| `src/ui/pages/admin/SettingsTab.tsx` | replace the "Not connected" line with live project/health status | low, text only |
| `docs/HANDOVER.md`, `README.md` | connection steps and status table | none |

### Explicitly **not** changing

`src/ui/styles.css`, page layouts, navigation structure, form markup and the
hash-based routing stay as they are. The point of keeping `getView()` returning
an `AppData` snapshot is that no page has to learn about Supabase.

---

## 6. Phased plan

| Phase | Work | Exit criteria |
| --- | --- | --- |
| **0. Pre-flight** (owner) | Apply both migrations to the Supabase project; confirm tables + RLS + `private-documents` bucket; decide seed vs empty start | `select count(*) from permissions;` > 0, bucket private |
| **1. Auth** | `client.ts`, `SupabaseBackend.signIn/signOut/changePassword/refresh`, session restore, `auth.users` → `profiles` onboarding, demo backend kept behind a flag | sign-in works on a real project; 155 tests still green |
| **2. Read model** | `getView()` built from RLS-filtered selects; `grants` derived from `assignments` + `posts`; same `AppData` shape | every page renders identical data; no UI diff |
| **3. Mutations (RPC)** | `submit_application`, `act_on_application`, `withdraw_application`, drafts, notices, admin config, retention — each re-implementing the checks from `ops/*.ts` inside the function | demo-vs-cloud parity tests; two officers acting at once still yields one conflict |
| **4. Documents** | upload to `private-documents` + signed URL read; stop writing `inline_data` | attachment flows work, blob never exceeds the cap |
| **5. Notices, notifications, statistics, audit** | wire remaining reads/writes; keep CSV client-side | audit rows appear; immutability trigger verified |
| **6. Deploy & cutover** | Variables in GitHub, Pages build, smoke test on the live URL, keep `localStorage` demo as an explicit fallback | production URL talks to Supabase; no secret in the bundle (`deploy.yml` already greps for `service_role`) |

Rough effort: phase 1–2 ≈ 1–2 days, phase 3 is the bulk (3–5 days), 4–6 ≈ 2 days.

### Must-keep invariants while porting

- Authorisation derived from **live post assignments** only; ending an
  assignment revokes queue, history, documents and notice rights immediately.
- Self-approval skipped; VC "approve and forward" never marks a record final.
- Confidential applications readable only by the acting post (or break-glass).
- System administrator/auditor: audit log yes, application contents no.
- Internal remarks never reach the applicant.
- Retention: dry run → second approver → typed confirmation; legal holds block.
- Audit rows append-only; every mutation writes one.
- No secret in the repository or bundle — publishable key only.

---

## 7. Missing information before implementation

1. **Project URL + publishable/anon key** — put them in `.env.local` (local) and
   repository **Variables** (Pages). Do not paste them in chat.
2. **Have the two migrations been applied?** If yes, add the RPC migration next;
   if no, apply the current ones first so the adapter has something to talk to.
3. **Start empty or seed the cloud?** Empty means no demo users in production
   (safest). Seeded means a demo login on the live site (faster to demo).
4. **Identity & email** — is Supabase Auth email + SMTP configured, or should
   activation/reset links keep being shown on screen as they are now?
5. **Data migration** — is there existing data (from the browser export) that
   must be imported, or is a fresh start acceptable?
6. **Branding** — the university name lives in `settings.university_name`
   (`SGT University`); the app title is hard-coded in `index.html`. Confirm the
   exact wording to use ("SGT University Application System").
7. **Hosting** — stay on GitHub Pages (no server, anon key + RLS only), or move
   to a host with functions for server-side work?
8. **Retention policy** — the periods are proposals; deletion needs a formal
   sign-off before any real data is destroyed.

---

## 8. Recommended next commit

Phase 1 + 2 in one PR: add `@supabase/supabase-js`, the client factory, the
shared backend interface, `SupabaseBackend` for auth + read model, env injection
in `deploy.yml`, and adapter tests with a mocked client. The UI does not change,
the demo build keeps working without env variables, and the live site only
switches over once the Variables exist.
