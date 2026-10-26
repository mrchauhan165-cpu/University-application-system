import { Icon } from '../components/Icons';
import { Alert, Button, Card, CardHeader, Chip, PageHeader } from '../components/UI';
import { useApp } from '../context';

const FAQ = [
  {
    q: 'Who can see my application?',
    a: 'You always see your own applications. Officers see an application only while it is at their stage, or after it has passed through their post — and only within the post’s organisational scope. Former post holders lose access immediately when their assignment ends.',
  },
  {
    q: 'Why can’t I approve my own application?',
    a: 'Self-approval is blocked by the backend. If a department head applies for leave, the workflow skips their own stage and routes the application to the next configured independent authority.',
  },
  {
    q: 'What does “VC approved — further approval pending” mean?',
    a: 'The Vice-Chancellor chose “Approve and forward”, so the application is NOT finally approved. It is waiting at the configured higher post (for example the Chancellor). The status only becomes “Completed” when that post finalises it.',
  },
  {
    q: 'What happens to applications in progress when a workflow changes?',
    a: 'Each application stores the workflow version it was submitted under, so changing a workflow never rewrites an in-progress route. Moving an application to a new workflow is a separate, explicit and audited action for the workflow administrator.',
  },
  {
    q: 'Who can read confidential applications?',
    a: 'Only the officer who is currently required to act on the application, or a post granted the separate break-glass permission. System administrators deliberately have no access to application contents.',
  },
  {
    q: 'How are notices scoped?',
    a: 'The creator’s current post decides the available audience. A mentor may publish only to their section, an HOD to their department, a Dean to their faculty, and only posts with the university-notice permission may publish university-wide.',
  },
  {
    q: 'What is the batch retention process?',
    a: 'A graduated batch enters a retention workflow with a dry run, a second-officer approval, legal-hold checks and a typed confirmation before anything is deleted. Initial cleanup and the final deletion are separate stages, and other batches are never affected.',
  },
  {
    q: 'Where are my documents stored?',
    a: 'Private storage with permission checks on every open. In this prototype, small demo attachments are kept in your browser’s local storage; the production schema uses a private object-storage bucket with short-lived signed URLs.',
  },
];

export function HelpPage() {
  const { data, backend } = useApp();
  return (
    <>
      <PageHeader
        title="Help & support"
        subtitle="How access, approvals and retention work in this portal."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Help' }]}
      />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <CardHeader title="Frequently asked questions" />
            <div className="card-pad">
              {FAQ.map((item) => (
                <details key={item.q} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>{item.q}</summary>
                  <p style={{ marginTop: 8, fontSize: '0.86rem', color: 'var(--ink-2)' }}>{item.a}</p>
                </details>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="About this prototype" subtitle="What is real, and what needs configuration." />
            <div className="card-pad stack" style={{ fontSize: '0.87rem', color: 'var(--ink-2)' }}>
              <div>
                <strong>Working end to end in this build</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>Authentication, invitations/activation, password reset and lockout</li>
                  <li>Configurable faculties, departments, batches, sections, posts and assignments</li>
                  <li>Application drafting, submission, correction, withdrawal and document upload</li>
                  <li>Approval routing, VC approve-and-forward, self-approval blocking, workflow versioning</li>
                  <li>Post-based history, permission-filtered documents and notifications</li>
                  <li>Scoped notices with read receipts, and scope-limited statistics with CSV export</li>
                  <li>Retention dry runs, second-approver gates, legal holds and deletion audit</li>
                  <li>Audit log, account suspension and assignment revocation</li>
                </ul>
              </div>
              <div>
                <strong>Requires the owner’s configuration before production</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>Apply the SQL migrations in <span className="mono">supabase/migrations</span> to a real Supabase project and enable RLS</li>
                  <li>Create private storage buckets and per-bucket policies</li>
                  <li>Configure Auth URLs (site URL, redirect URLs) and an email provider</li>
                  <li>Replace demo university name, logo, posts and seed data with the university’s own</li>
                  <li>Have the university formally approve the retention schedule and break-glass policy</li>
                </ul>
              </div>
              <Alert tone="warn" title="This build stores its data in this browser.">
                The prototype keeps data in local storage so it runs on any static host with no server and no cost.
                Clearing site data resets it to the seeded demo. A system administrator can export/import the data set
                from Administration → Settings.
              </Alert>
              <div className="row">
                <Button variant="secondary" onClick={() => { window.location.hash = '#/admin/settings'; }}>
                  <Icon.Settings size={15} /> Open settings
                </Button>
                <Button variant="ghost" onClick={() => backend.refresh()}>
                  <Icon.Undo size={15} /> Refresh data
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Access rules in one picture" />
            <div className="card-pad">
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.86rem', lineHeight: 1.8, color: 'var(--ink-2)' }}>
                <li><strong>Account</strong> — you must be active and signed in.</li>
                <li><strong>Post</strong> — an officer action needs a live assignment for the post the application sits at.</li>
                <li><strong>Scope</strong> — the assignment must cover the application’s faculty/department/batch/section.</li>
                <li><strong>Permission</strong> — the post must include the relevant permission (view, act, documents, statistics, notices).</li>
                <li><strong>Stage</strong> — actions are only possible while the application is at your stage.</li>
                <li><strong>Self-approval</strong> — never allowed, even for a senior officer.</li>
              </ol>
              <div style={{ marginTop: 12 }}>
                <Alert tone="info">
                  Hiding a button is never the security boundary: every rule above is enforced again in the backend on
                  each request.
                </Alert>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Support" />
            <div className="card-pad" style={{ fontSize: '0.87rem', color: 'var(--ink-2)' }}>
              <p>
                <strong>{data.settings.university_name}</strong>
                <br />
                Email: <a href={`mailto:${data.settings.support_email}`}>{data.settings.support_email}</a>
              </p>
              <p className="cell-sub" style={{ marginTop: 8 }}>
                Timezone used for display: {data.settings.timezone}. Dates are stored in UTC.
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <Chip tone="neutral">Demo data</Chip>
                <Chip tone="neutral">No real student records</Chip>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Keyboard &amp; accessibility" />
            <div className="card-pad" style={{ fontSize: '0.86rem', color: 'var(--ink-2)' }}>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li>Use <kbd>Tab</kbd> to move between controls; focus is always visible.</li>
                <li><kbd>Esc</kbd> closes dialogs.</li>
                <li>Every form control has a label; errors are announced to screen readers.</li>
                <li>Status is conveyed by text as well as colour.</li>
                <li>Animations respect the “reduce motion” system setting.</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
