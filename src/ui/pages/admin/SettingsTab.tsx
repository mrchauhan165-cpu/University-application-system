import { useRef, useState } from 'react';
import { Alert, Button, Card, CardHeader, Field, Modal, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';

export function SettingsTab() {
  const { data, backend, notify } = useApp();
  const [name, setName] = useState(data.settings.university_name);
  const [short, setShort] = useState(data.settings.university_short);
  const [email, setEmail] = useState(data.settings.support_email);
  const [timezone, setTimezone] = useState(data.settings.timezone);
  const [retention, setRetention] = useState(String(data.settings.retention_months));
  const [finalRetention, setFinalRetention] = useState(String(data.settings.final_retention_months));
  const [resetting, setResetting] = useState(false);
  const [resetText, setResetText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const storageBytes = (() => {
    try {
      const raw = window.localStorage.getItem('uas.v1.state') ?? '';
      return raw.length;
    } catch {
      return 0;
    }
  })();

  function save() {
    try {
      backend.saveSettings({
        university_name: name,
        university_short: short,
        support_email: email,
        timezone,
        retention_months: Number(retention),
        final_retention_months: Number(finalRetention),
      });
      notify('Settings saved.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  function exportData() {
    try {
      const json = backend.exportState();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `university-portal-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify('Data set exported. Store it securely — it contains demo personal data.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  async function importData(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      backend.importState(text);
      notify('Data set imported. Reload the page if a screen looks stale.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  return (
    <div className="stack">
      <Alert tone="warn" title="Production checklist.">
        Before real use: apply the SQL migrations, configure Auth URLs and email, create private storage buckets with
        policies, replace the demo university identity, and have the retention schedule formally approved. This screen
        only changes values inside this prototype’s data set.
      </Alert>

      <Card>
        <CardHeader title="University identity" subtitle="Shown in the header, footer and sign-in page." />
        <div className="card-pad">
          <div className="form-grid">
            <Field label="University name" htmlFor="set-name">
              <TextInput id="set-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Short name / logo initials" htmlFor="set-short" hint="Used in the placeholder logo.">
              <TextInput id="set-short" value={short} maxLength={8} onChange={(e) => setShort(e.target.value)} />
            </Field>
            <Field label="Support email" htmlFor="set-email">
              <TextInput id="set-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Timezone (display only)" htmlFor="set-tz">
              <TextInput id="set-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
            <Field label="Default initial cleanup (months after graduation)" htmlFor="set-retention">
              <TextInput id="set-retention" type="number" value={retention} onChange={(e) => setRetention(e.target.value)} />
            </Field>
            <Field label="Default additional period before final deletion (months)" htmlFor="set-final">
              <TextInput id="set-final" type="number" value={finalRetention} onChange={(e) => setFinalRetention(e.target.value)} />
            </Field>
          </div>
          <Button onClick={save}>Save settings</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Data set" subtitle="Prototype storage is this browser’s local storage." />
        <div className="card-pad stack">
          <Alert tone="info" title={`${(storageBytes / 1024).toFixed(0)} KB used of roughly 4 MB available.`}>
            Attachments are limited to keep the demo portable. A production deployment stores files in private object
            storage instead.
          </Alert>
          <div className="row">
            <Button variant="secondary" onClick={exportData}>
              <Icon.Download size={15} /> Export data set (JSON)
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <Icon.Upload size={15} /> Import data set
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(e) => {
                void importData(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button variant="danger" onClick={() => { setResetting(true); setResetText(''); }}>
              <Icon.Trash size={15} /> Reset demo data
            </Button>
          </div>
          <p className="cell-sub">
            Exports contain demo personal data and audit history. Never commit an export to a public repository.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Authentication policy" subtitle="Documented here; enforced by your identity provider in production." />
        <div className="card-pad">
          <dl className="kv">
            <dt>Multi-factor authentication</dt>
            <dd>
              {data.settings.mfa_required_for_privileged ? 'Required for privileged posts (policy)' : 'Recommended for privileged posts'}{' '}
              — configure MFA in Supabase Auth before production.
            </dd>
            <dt>Self registration</dt>
            <dd>Disabled. Accounts are created by authorised administrators and activated with single-use links.</dd>
            <dt>Session lifetime</dt>
            <dd>12 hours in this prototype. Configure JWT expiry and refresh rotation in the auth provider.</dd>
            <dt>Password policy</dt>
            <dd>Minimum 10 characters with upper case, lower case and a number; hashed with a per-user salt (demo) or GoTrue (production).</dd>
            <dt>Lockout</dt>
            <dd>Five failed attempts trigger a short lock, recorded per account.</dd>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader title="Environment" />
        <div className="card-pad">
          <dl className="kv">
            <dt>Mode</dt>
            <dd>Demo — data stored in this browser ({backend.mode})</dd>
            <dt>Frontend</dt>
            <dd>Static build, hash routing, deployable to GitHub Pages or any static host</dd>
            <dt>Backend contract</dt>
            <dd>All reads/writes go through a permission-checking service layer; Supabase SQL with RLS is provided for deployment</dd>
            <dt>Secrets in this build</dt>
            <dd>None. No service-role keys, database passwords or SMTP credentials are used.</dd>
          </dl>
        </div>
      </Card>

      {resetting ? (
        <Modal
          open
          onClose={() => setResetting(false)}
          title="Reset demo data"
          footer={
            <>
              <Button variant="secondary" onClick={() => setResetting(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={resetText.trim().toUpperCase() !== 'RESET'}
                onClick={() => {
                  backend.resetDemoData();
                  setResetting(false);
                  notify('Demo data reset. Please sign in again.', 'info');
                }}
              >
                Reset everything
              </Button>
            </>
          }
        >
          <Alert tone="danger" title="This replaces all current data.">
            Every application, notice, account and audit entry in this browser will be replaced by the original seeded
            demo data. Export first if you need to keep anything.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="Type RESET to confirm" htmlFor="reset-confirm" required>
              <TextInput id="reset-confirm" value={resetText} onChange={(e) => setResetText(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
