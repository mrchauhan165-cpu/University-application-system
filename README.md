# University Application System

A role-based portal for university applications, approvals, notices, statistics,
file attachments and record retention. The whole product runs as a **static
site** — no Node, PHP or database server is required to try it — so it can be
hosted on GitHub Pages, Netlify, S3, nginx, or any other static host.

> **Honest status.** This repository contains a complete, working **prototype**
> with a browser-side service layer. Every rule described below is enforced in
> `src/backend` and is covered by automated tests (108 of them at the time of
> writing). It is **not yet connected to a real database, email service or file
> store**; see [What is not production-ready](#what-is-not-production-ready).
> All data in the demo is fictional and labelled as such in the interface.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 108 tests: authorisation, workflow, notices, retention, UI
npm run build      # typecheck + static build into dist/
```

Sign in with any demo account below. The password for every demo account is
`Demo@12345` (shown on the sign-in screen; it is demo data, not a credential).

| Account | Role | Useful for |
| --- | --- | --- |
| `student.a@demo.university` | Student (section A) | submitting, own records, tracking |
| `student.b@demo.university` | Student (section A) | confidential grievance |
| `student.c@demo.university` | Student (section B) | section-scoped visibility |
| `teacher@demo.university` | Staff, no post | staff claim, no approvals |
| `mentor.a@demo.university` | Mentor, section A | first approval stage |
| `mentor.b@demo.university` | Mentor, section B | parallel section |
| `hod.cse@demo.university` | Head of Department (CSE) | department queue, statistics |
| `dean.eng@demo.university` | Dean, Engineering | faculty statistics |
| `registrar@demo.university` | Registrar | university-wide officer |
| `pvc@demo.university` | Pro-Vice-Chancellor | senior approval |
| `vc@demo.university` | Vice-Chancellor | "Approve and forward" vs finalise |
| `chancellor@demo.university` | Chancellor (custom post above VC) | final authority above the VC |
| `wfadmin@demo.university` | Workflow Administrator | types, workflows, retention |
| `sysadmin@demo.university` | System Administrator | structure, accounts, settings |
| `auditor@demo.university` | Compliance Auditor | audit log, no application contents |
| `former.hod@demo.university` | Former HOD (assignment ended) | proof that history access is revoked |

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

**Posts, permissions and scope**
- Posts are data, not code. Any number of custom posts can be created, including
  posts above the VC, each with its own permission set and scope type
  (university / faculty / department / batch / section).
- Permissions are separate dimensions: submit, view, act, view documents,
  statistics, publish notices, university-wide notices, manage users, configure
  workflows, manage retention, view audit, confidential access.
- Assignments have start/end dates and full history. Ending an assignment
  revokes **only that assignment**: the person keeps their other posts, loses the
  old post's queue, history, notices and file links immediately, and the next
  holder sees the same history with the original actor names preserved.
- Being senior is not enough: the system administrator and auditor can see the
  audit log but not application contents.

**Applications and approvals**
- Configurable types: who may apply, fields, required documents, confidentiality,
  withdrawal, retention category, extra viewer posts, fallback approver.
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
src/ui/__tests__/render.test.tsx              every role and every admin tab renders
src/ui/__tests__/flows.test.tsx               submit → approve → applicant view, revoked access
```

Run them with `npm test`. UI tests use jsdom, so no browser download is needed.

---

## Deployment

### GitHub Pages (included)

`.github/workflows/deploy.yml` typechecks, tests, builds and publishes on every
push to `main`:

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. The site appears at
   `https://<user>.github.io/<repository>/` (the workflow sets the base path
   automatically; set the repository variable `BASE_PATH=/` for a user site or a
   custom domain).

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
   `VITE_SUPABASE_ANON_KEY` (see `.env.example`) — publishable values only.

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
