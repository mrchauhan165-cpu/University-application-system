# University Application System

A role-based portal for university applications, approvals, notices, statistics,
file attachments and record retention. The whole product runs as a **static
site** — no Node, PHP or database server is required to try it — so it can be
hosted on GitHub Pages, Netlify, S3, nginx, or any other static host.

> **Honest status.** This repository contains a complete, working **prototype**
> with a browser-side service layer. Every rule described below is enforced in
> `src/backend` and is covered by automated tests (155 of them at the time of
> writing). It is **not yet connected to a real database, email service or file
> store**; see [What is not production-ready](#what-is-not-production-ready).
> All data in the demo is fictional and labelled as such in the interface.

---

## Quick start

Requires **Node.js 20 or newer** (CI and the tests run on Node 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 155 tests: authorisation, workflow, notices, retention, UI
npm run build      # typecheck + static build into dist/
npm run preview:dist   # serve the built site on :5173, exactly as a host would
```

> Previews inside an embedded iframe can have browser storage blocked. The portal
> detects that, keeps working from memory and shows a small "data is not saved"
> notice instead of failing to load.

Sign in with any demo account below. Every demo account uses the password
`Demo@12345`. These are seeded test accounts, not real credentials: the sign-in
screen deliberately does not display them, so keep this table to yourself when
demoing.

| Account | Code | Role / post | Useful for |
| --- | --- | --- | --- |
| `student.a@demo.university` | STU0001 | Student, CSE · section A | submitting, own records, tracking |
| `student.b@demo.university` | STU0002 | Student, CSE · section A | confidential grievance |
| `student.c@demo.university` | STU0003 | Student, CSE · section B | section-scoped visibility |
| `student.ece@demo.university` | STU0004 | Student, ECE · section A | another department |
| `teacher@demo.university` | FAC0004 | Staff, no post | staff claim, no approvals |
| `mentor.a@demo.university` | FAC0001 | Mentor, CSE section A | first approval stage |
| `mentor.b@demo.university` | FAC0002 | Mentor, CSE section B | parallel section |
| `mentor.ece@demo.university` | FAC0003 | Mentor, ECE section A | parallel department |
| `hod.cse@demo.university` | HOD0001 | Head of Department (CSE) | department queue, statistics |
| `hod.ece@demo.university` | HOD0002 | Head of Department (ECE) | separate department scope |
| `dean.eng@demo.university` | DEAN0001 | Dean, Engineering & Technology | faculty statistics |
| `dean.sci@demo.university` | DEAN0002 | Dean, Basic & Applied Sciences | second faculty |
| `registrar@demo.university` | REG0001 | Registrar | university-wide officer |
| `pvc@demo.university` | PVC0001 | Pro-Vice-Chancellor | senior approval |
| `vc@demo.university` | VC0001 | Vice-Chancellor | "Approve and forward" vs finalise |
| `chancellor@demo.university` | CHN0001 | Chancellor (custom post above VC) | final authority above the VC |
| `wfadmin@demo.university` | ADM0001 | Workflow Administrator | types, workflows, retention |
| `sysadmin@demo.university` | SYS0001 | System Administrator | structure, accounts, settings |
| `auditor@demo.university` | AUD0001 | Compliance Auditor | audit log, no application contents |
| `former.hod@demo.university` | FAC0005 | Former HOD (assignment ended) | proof that history access is revoked |

Password for all of the above: **`Demo@12345`**

Dean, Registrar, PVC, VC and Chancellor are **approve-only** accounts: sign in as
one of them and the "New Application" entry disappears, and the server refuses a
submit attempt even if it is replayed by hand. Use a student, teacher, mentor or
HOD account to raise an application.

---

## What works

**Structure and identity**
- University → Faculty → Department → Batch → Section → Students, with a current
  mentor assignment per section. No semester concept anywhere.
- Batches are independent records with their own lifecycle
  (`planned → active → graduated → archived → retention → deleted`).
- Permanent, readable, collision-safe IDs: `STU0001`, `TCH0002`, `APP-2026-00007`.
- Invitation → activation with single-use expiring links; no default or plaintext
  passwords (salted PBKDF2-style hashing in demo, GoTrue in production);
  five-failure lockout; session expiry and revocation; audited account changes.
- Students self-serve **only** their username (sign-in email) and password, both
  confirmed with the current password and recorded in the audit log. Name,
  department, batch, section and roll number stay administrator-managed.

**Posts, permissions and scope**
- Posts are data, not code. Any number of custom posts can be created, including
  posts above the VC, each with its own permission set and scope type
  (university / faculty / department / batch / section).
- Permissions are separate dimensions: submit, view, act, view documents,
  statistics, publish notices, university-wide notices, manage users, configure
  workflows, manage retention, view audit, confidential access.
- **Approve-only senior posts.** Dean, Registrar, PVC, VC and Chancellor ship
  *without* the submit permission: they take decisions but can never raise an
  application. The rule lives in the backend (`SessionUser.canSubmit` and the
  submit guard in `ops/applications.ts`), so hiding the buttons is cosmetic.
  An administrator can grant submit back to a post if a university wants it.
- Assignments have start/end dates and full history. Ending an assignment
  revokes **only that assignment**: the person keeps their other posts, loses the
  old post's queue, history, notices and file links immediately, and the next
  holder sees the same history with the original actor names preserved.
- Being senior is not enough: the system administrator and auditor can see the
  audit log but not application contents.
- Teachers are added per department from **Administration → Organisation →
  Departments** (Teachers column) and can be moved to another department in one
  action; profile, queue and notices follow and the change is audited. A move is
  refused while the person still holds a live post in the old department, because
  that post carries the access.

**Applications and approvals**
- Configurable types: who may apply, fields, required documents, confidentiality,
  withdrawal, retention category, extra viewer posts, fallback approver.
- Six default types, including **Other request** — the applicant writes their own
  subject and details (optional attachment) for anything without a standard form.
  Students route mentor → HOD; staff have no section, so the mentor stage is not
  applicable and routing moves straight to the HOD.
- Drafts, validation with per-field messages, unique reference numbers, own-records
  visibility, correction and resubmission after a return.
- Actions: approve, reject (reason required), return for correction (remarks
  required), request clarification, internal notes, finalise.
- Every action re-checks the actor's assignment, post scope, stage and the
  self-approval rule at the moment it is submitted; two officers acting at once
  cannot both succeed (one gets a clear conflict/invalid-state error).
- The VC stage has a distinct **Approve / Finalise** and **Approve and forward**.
  With a configured higher post the application becomes
  "VC approved — further approval pending" and only that higher post completes it.
- Workflows are versioned. Applications keep the version they were submitted
  under; re-routing is an explicit, audited administrator action.
- Applicant-visible remarks and internal notes are stored separately; internal
  notes never reach the applicant or their timeline.

**Notices, statistics, search**
- Notices are scope-checked on create/edit/publish/archive/delete, support
  audiences, drafts, scheduling, expiry, archiving, attachments, read receipts
  and preserve the original author.
- Statistics, reports and search are limited to the viewer's scope; an export is
  recorded in the audit log.
- In-app notifications with unread badge, toasts and deep links that re-check
  permission when opened. Notification fan-out is de-duplicated.

**Files**
- Opaque document IDs, MIME and size validation (3 MB applications, 2 MB notices),
  executables rejected, private storage semantics, permission re-checked on every
  read.

**Retention** (never automatic)
- Dry-run counts → second authorised officer approval → legal-hold check →
  typed confirmation → deletion, with a deletion audit entry. Open applications
  and legal/permanent categories are preserved.

---

## What is not production-ready

Read this before using the repository for real people's data.

| Area | Current state | What is needed |
| --- | --- | --- |
| Backend | A TypeScript service layer running in the browser, persisted to `localStorage` | Port `src/backend/ops/*.ts` to Supabase RPCs (schema + RLS drafts are in `supabase/migrations`) |
| Database | SQL migrations are provided but **untested against a live project** (no PostgreSQL in the build environment) | Apply to a staging project, review policies with a second pair of eyes |
| Email | Activation, reset and notification emails are **not sent**; the demo shows the single-use link on screen instead | Configure Supabase Auth SMTP + email templates |
| Files | Attachments are stored as data in the browser's storage (capped at ~4 MB total) | Private object storage + signed URLs |
| Real-time | Not implemented; screens refresh after each action | Supabase Realtime or polling |
| Multi-device | Data lives per browser; two devices do not share state | The database backend above |
| Backup | Export/import JSON from Settings | Database backups + retention of audit logs |
| Identity | Password + lockout in demo | MFA for privileged posts, SSO if required |

Nothing in this repository contains a secret. There is no service-role key, no
database password and no SMTP credential — and none should ever be added to the
repository or to the frontend bundle.

---

## Security model

- **Authorisation is server-side by design.** UI checks only decide what to show;
  every read is filtered and every write is validated in `src/backend`
  (`authz.ts`, `ops/*.ts`). The SQL migration expands the same rules as RLS.
- **Scope-first.** A post only ever sees records inside its assignment scope and
  only those its post has held or currently holds.
- **Confidential records** are visible to the applicant and to the officer who
  must act, plus explicitly authorised break-glass posts. Administrators are
  excluded, and the restriction is enforced on documents too.
- **History follows the post, not the person.** Ending an assignment removes the
  former holder's access to that post's queue, history, notices and files.
- **Passwords** are salted and hashed; no plaintext, default or shared password is
  ever generated. Sessions expire after 12 hours and are revoked on suspension.
- **Audit** entries are append-only (a database trigger enforces this in SQL) and
  record actor, post, scope, before/after status and time.

### Automated tests

```
src/backend/__tests__/security.test.ts        authentication, record access, handover, self-approval
src/backend/__tests__/workflow.test.ts        routes, VC stage, remarks, documents, versioning
src/backend/__tests__/notices-stats.test.ts   notice scopes, read receipts, statistics scope
src/backend/__tests__/admin-retention.test.ts structure, accounts, retention gates
src/backend/__tests__/edge-cases.test.ts      confidential access, notification dedupe, scheduled notices, passwords
src/backend/__tests__/requests.test.ts        approve-only posts, free-text requests, department transfers
src/ui/__tests__/render.test.tsx              every role and every admin tab renders
src/ui/__tests__/flows.test.tsx               submit → approve → applicant view, revoked access
src/ui/__tests__/teacher-admin.test.tsx       add teacher, move department, blocked-by-live-post
```

Run them with `npm test`. UI tests use jsdom, so no browser download is needed.

---

## Deployment

### GitHub Pages (included)

`.github/workflows/deploy.yml` typechecks, tests, builds and publishes on every
push to `main`:

1. Push the repository to GitHub.
2. Enable Pages once, as the repository owner:
   **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   This is the only manual step, and it cannot be automated: creating a Pages
   site requires repository admin rights, which the workflow token does not have.
   Until it is enabled, the workflow still typechecks, tests and builds, and says
   so in the run summary instead of failing.
3. Push to `main` (or re-run the workflow). The site appears at
   `https://<user>.github.io/<repository>/`.
   The base path is read from Pages itself, so project sites, user sites and
   custom domains all work without editing anything (override with the
   repository variable `BASE_PATH` only if you need to).

### Any other static host

```bash
VITE_BASE_PATH=/ npm run build     # dist/ is a plain static site
```

Upload `dist/` to Netlify, Cloudflare Pages, S3 + CloudFront, nginx or an
internal file share. Routing is hash-based (`/#/applications`), so **no server
rewrites or SPA fallbacks are required** and deep links survive a refresh.

### Connecting a real backend later

1. Create a Supabase project (free plan is enough to start).
2. Apply `supabase/migrations/*.sql` in filename order (SQL editor or
   `supabase db push`) — to **staging first**.
3. Create the private `private-documents` bucket policies (included in the RLS
   migration) and configure Auth URLs, SMTP and MFA.
4. Port the operations in `src/backend/ops/` to `security definer` RPCs, keeping
   the same input/output shapes (`OpContext`, `ApiError` codes).
5. Point the frontend at the project with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (see `.env.example`) — publishable values only. On
   GitHub Pages these come from **Settings → Secrets and variables → Actions →
   Variables**; the deploy workflow passes them to the build.
6. Sign in as the system administrator and open **Administration → Settings →
   Cloud connection → Test cloud connection**. It checks the URL, the key and
   whether the migrations ran, without reading any personal data. The data layer
   still runs on browser storage until the adapter ships.

Step-by-step instructions written for a non-developer are in
[`docs/HANDOVER.md`](docs/HANDOVER.md).

---

## Project structure

```
src/
  domain/types.ts            canonical data model shared by UI and service layer
  backend/
    authz.ts                 permission + scope + confidentiality decisions
    workflow.ts              stage routing, self-approval skipping, versioning
    session.ts               session building from live assignments
    crypto.ts                hashing, tokens, password strength
    store.ts                 persistence (localStorage / memory) and guards
    seed.ts                  fictional university data
    local.ts                 the service API used by the UI
    ops/                     operations: applications, notices, admin, retention
    __tests__/               security, workflow, notices, retention, edge cases
  ui/
    context.tsx              store subscription + router + toasts
    components/              layout, UI primitives, icons, document viewer
    lib/                     formatting and selection helpers
    pages/                   dashboard, applications, notices, stats, admin tabs…
    __tests__/               render and flow tests
supabase/migrations/         schema + RLS + private storage (production draft)
docs/HANDOVER.md             beginner-friendly operating and transfer guide
```

## Data and privacy

The demo data is fictional: names such as "Aarav Student" and posts such as
"HOD CSE" exist only to exercise the rules. Do not put real personal data into
the demo build; it is stored unencrypted in the browser profile that created it.
Use **Settings → Export** to take a copy and **Reset demo data** to wipe it.
