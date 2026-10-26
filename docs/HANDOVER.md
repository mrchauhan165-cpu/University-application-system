# Handover guide

Everything you need to run, demonstrate, operate and hand over this portal —
written so that it can be followed on a phone, one step at a time.

There are three ways to use this document:

- **A. Just show it** — run it on a laptop or a free static host (10 minutes).
- **B. Publish it** — put it on GitHub Pages with a web address (15 minutes).
- **C. Run it for real** — connect a database, email and file storage (needs a
  developer or an IT colleague; see the last section).

---

## A. Show it in 10 minutes

You need a computer with [Node.js 20 or newer](https://nodejs.org) installed.

1. Open a terminal in the project folder.
2. Type `npm install` and press Enter. Wait for it to finish (about a minute).
3. Type `npm run dev` and press Enter.
4. Open the address printed in the terminal (usually `http://localhost:5173`).
5. Type one of the demo usernames below and the password **`Demo@12345`**, then
   press **Sign in**. (The sign-in screen no longer lists demo accounts.)

| Username | Shows |
| --- | --- |
| `student.a@demo.university` | a student: own applications only |
| `mentor.a@demo.university` | first approval stage |
| `hod.cse@demo.university` | department queue and statistics |
| `vc@demo.university` | “Approve and forward” vs finalise |
| `sysadmin@demo.university` | structure, accounts, settings |

Every seeded account (students, mentors, HODs, deans, registrar, PVC, VC,
Chancellor, both administrators, auditor) uses the same demo password
`Demo@12345`. A student may change only their own username and password from
**Profile**; everything else is administrator-managed.

Try these four minutes of demonstration:

| Minute | Sign in as | Show |
| --- | --- | --- |
| 1 | `student.a@demo.university` | *New Application* → *Leave request* → fill and submit; note the reference number |
| 2 | `mentor.a@demo.university` | *My Pending Actions* → open it → **Approve and pass to next stage** |
| 3 | `hod.cse@demo.university` | Open the same application → approve/finalise; then *Statistics* (department only) |
| 4 | `vc@demo.university` | A staff leave request → note **Approve and forward** sends it to the Chancellor and does **not** finalise it |

To stop the server press `Ctrl + C`.

**Previewing a built copy** (this is what a real host serves):

```bash
npm run build
npm run preview:dist      # http://localhost:5173
```

> The demo stores its data inside the browser you are using. It is not shared
> between devices, and clearing your browser data resets it.

---

## B. Publish it (GitHub Pages)

You need a free GitHub account. The repository includes the deployment workflow.

1. Create a new **empty** repository on GitHub, for example
   `university-application-system`.
2. Upload the project (choose whichever is easiest):
   - **On a computer:** in the project folder run
     `git remote add origin https://github.com/<your-name>/<repository>.git`,
     then `git push -u origin main`.
   - **On a phone:** use the GitHub mobile app or the GitHub website
     **Add file → Upload files** (upload the folder contents, not `node_modules`).
3. Open the repository on GitHub → **Settings** → **Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open the **Actions** tab → **Build and deploy to GitHub Pages** →
   **Run workflow** (or simply push a commit to `main`).
6. Wait for the green tick (about two minutes). The address is shown on the
   workflow run and under **Settings → Pages**, for example
   `https://<your-name>.github.io/university-application-system/`.

Notes:

- The site works from that address with no server: pages are addressed with `#`
  (for example `…/#/applications`), so refreshing never breaks.
- If you use a custom domain or a user site (`<name>.github.io`), add a
  repository variable `BASE_PATH` with the value `/`
  (**Settings → Secrets and variables → Actions → Variables**).
- The workflow runs the tests before publishing. If a test fails, nothing is
  published — read the log to see which one.

**Other hosts** (Netlify, Cloudflare Pages, S3, an internal web server): run
`npm run build` and upload the contents of `dist/`. If the site will live in a
sub-folder, set `VITE_BASE_PATH=/that-folder/` before building.

---

## C. Day-to-day operation (once in use)

### 1. First-time setup (as `sysadmin`)

1. **Administration → Organisation**: check faculties → departments → batches →
   sections. Rename them to your real names, or archive the demo rows and add
   your own.
2. **Administration → Posts & permissions**: keep, change or add posts. A post is
   a set of permissions plus a scope (university / faculty / department / batch /
   section). You can create posts above the VC.
3. **Administration → Users**: create people. Students need a batch **and** a
   section. Each person gets a permanent code (`STU0001`).
4. **Administration → Post assignments**: give people their posts with an
   effective date. One person may hold several posts.
5. Send each new person their **activation link** (Users tab → *Activation link*).
   They choose their own password; you never see it.

### 2. Configure what can be applied for

1. **Administration → Application types** → *New type*: name, who may apply,
   fields, required documents, whether it is confidential, whether drafts and
   withdrawal are allowed, the retention category, and a fallback approver.
2. **Administration → Workflows** → choose the type → *Create/Edit route*: add the
   approval stages in order and pick the post for each. Optionally add a post
   **beyond the final authority** (for example the Chancellor).
3. Saving creates a **new version**. Applications already in progress keep the
   version they started under. To move them, use *Move to current route* — it is
   explicit, audited, and notifies the applicant and the receiving post.

### 3. Daily work

- **Applicants** use *My Applications*; a returned application can be corrected
  and resubmitted from the same screen.
- **Officers** use *My Pending Actions* (their post's queue) and *Post History*.
  Every action re-checks that they still hold the post.
- **Notices** can be drafted, scheduled, published, archived and given
  attachments; read receipts show who has read them.
- **Statistics** are limited to the viewer's scope and every export is written to
  the audit log.

### 4. Retention (archive → cleanup → deletion)

Retention is deliberately slow and manual:

1. Mark a batch **graduated** or **archived** (Administration → Organisation).
2. After the configured waiting period, a retention manager proposes
   **initial cleanup** — the system shows a dry-run count of what would be
   affected and how many records are protected.
3. A **different** authorised officer approves it.
4. Execution requires typing the batch label. Open applications, legal/permanent
   categories and any batch on **legal hold** are always preserved.
5. The additional retention period follows, then a **final deletion** job repeats
   the same gates. Every step is written to the deletion audit.

Nothing is ever deleted automatically.

### 5. Backups and transfers

- **Settings → Export data set** saves a JSON copy (contains demo/personal data —
  store it encrypted, never in the repository).
- **Import** restores a copy. **Reset demo data** wipes everything and reloads the
  original sample.
- To hand the portal to someone else: transfer the repository (GitHub →
  Settings → Transfer ownership) and give them this document.

---

## C2. What to tell your IT colleague

The frontend is a static site; there is no server to patch.

1. Host `dist/` on any static host (HTTPS strongly recommended).
2. No secrets are in the bundle — only a public/publishable key may be added later.
3. The repository contains `supabase/migrations/*.sql`:
   - `…_schema.sql` — tables, constraints, indexes, append-only audit log,
     reference/user-code sequences.
   - `…_rls.sql` — row-level security, scope helper functions, private storage
     bucket and policies.
   These are a **reviewed draft**, not yet run against a live database. Apply them
   to a staging project first, and have someone review the policies.
4. The operations in `src/backend/ops/` are the reference implementation of the
   business rules and must be ported to `security definer` RPCs so that all writes
   stay server-side. Do not grant the browser table write access.
5. Configure Supabase Auth (SMTP, site URL, MFA for privileged posts) before
   creating real accounts.
6. Files must go to a **private** bucket with short-lived signed URLs; never make
   the bucket public.

---

## Troubleshooting

| Symptom | What it means | What to do |
| --- | --- | --- |
| “Email or password is incorrect” | Wrong credentials, or the account is not activated | Check the demo password `Demo@12345`; ask the administrator to resend the activation link |
| “Too many failed attempts” | Five failures locked the account for a minute | Wait 60 seconds and try again |
| “This account has not been activated yet” | The invitation was created but never activated | Generate an activation link in Administration → Users |
| “You do not currently hold the post…” | Your assignment ended, or belongs to a different scope | Check Administration → Post assignments (you must hold a *current* assignment) |
| “Your browser storage is almost full” | Demo mode stores attachments in the browser | Remove large attachments, or Settings → Reset demo data |
| Blank page after publishing | The base path does not match the hosting folder | Set `VITE_BASE_PATH` (or the `BASE_PATH` repository variable) and redeploy |
| A change is not visible on another device | Demo data is per browser | A shared backend is required (see above) |

---

## Where things live

| Path | What it is |
| --- | --- |
| `src/domain/types.ts` | The data model, in one file |
| `src/backend/authz.ts` | Who may see or act on what |
| `src/backend/ops/` | The business operations (submit, act, notices, retention) |
| `src/backend/__tests__/` | The security and workflow tests you can run offline |
| `src/ui/pages/` | One file per screen; `admin/` holds the console tabs |
| `supabase/migrations/` | Database schema, RLS and storage policies (draft) |
| `.github/workflows/deploy.yml` | Automatic typecheck → test → publish |

If you change a rule, change it in `src/backend` **and** add a test — the UI must
never be the only place a rule is enforced.
