import { useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  Descriptions,
  Field,
  PageHeader,
  StatusChip,
  TextInput,
} from '../components/UI';
import { useApp, useSession } from '../context';
import { errorMessage } from '../../backend/errors';
import { formatDate, formatDateTime, humanise } from '../lib/format';
import { assignmentScopeText, postName } from '../lib/selectors';
import { PERMISSION_LABELS } from '../lib/constants';

export function ProfilePage() {
  const { data, backend, notify } = useApp();
  const current = useSession();
  const profile = current.profile;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dept = data.departments.find((d) => d.id === (profile.kind === 'student' ? profile.department_id : profile.home_department_id));
  const batch = data.batches.find((b) => b.id === profile.batch_id);
  const section = data.sections.find((s) => s.id === profile.section_id);
  const assignments = data.assignments
    .filter((a) => a.user_id === profile.id)
    .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1));

  const activeGrants = current.grants;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await backend.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify('Password updated.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="My profile & security"
        subtitle={`${profile.user_code} · ${humanise(profile.kind)} · ${profile.email}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Profile' }]}
        actions={<StatusChip status={profile.status} label={`Account ${profile.status}`} />}
      />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <CardHeader title="Personal details" subtitle="Managed by the university administrator — contact them to correct these." />
            <div className="card-pad">
              <Descriptions
                items={[
                  { label: 'Full name', value: profile.full_name },
                  { label: 'User code', value: <span className="mono">{profile.user_code}</span> },
                  { label: 'Email', value: profile.email },
                  { label: 'Phone', value: profile.phone ?? '—' },
                  { label: 'Account status', value: <StatusChip status={profile.status} label={humanise(profile.status)} /> },
                  { label: 'Joined', value: formatDate(profile.joined_on) },
                  { label: 'Last sign-in', value: profile.last_login_at ? formatDateTime(profile.last_login_at) : '—' },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title={profile.kind === 'student' ? 'Academic record' : 'Employment record'} />
            <div className="card-pad">
              <Descriptions
                items={
                  profile.kind === 'student'
                    ? [
                        { label: 'Department', value: dept?.name ?? '—' },
                        { label: 'Faculty', value: data.faculties.find((f) => f.id === dept?.faculty_id)?.name ?? '—' },
                        { label: 'Batch', value: batch?.label ?? '—' },
                        { label: 'Section', value: section?.name ?? '—' },
                        { label: 'Roll number', value: profile.roll_no ?? '—' },
                        {
                          label: 'Current mentor',
                          value:
                            data.assignments.find((a) => a.active && a.post_code === 'MENTOR' && a.scope.section_id === profile.section_id)
                              ? data.profiles.find(
                                  (p) =>
                                    p.id ===
                                    data.assignments.find(
                                      (a) => a.active && a.post_code === 'MENTOR' && a.scope.section_id === profile.section_id,
                                    )?.user_id,
                                )?.full_name ?? '—'
                              : 'Not assigned',
                        },
                      ]
                    : [
                        { label: 'Department', value: dept?.name ?? '—' },
                        { label: 'Designation', value: profile.designation ?? '—' },
                        { label: 'Current posts', value: current.postNames.join(', ') || 'No active post' },
                      ]
                }
              />
              <p className="cell-sub" style={{ marginTop: 12 }}>
                No semester structure is used: progression is tracked by faculty, department, batch and section.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Post assignments" subtitle="Every assignment keeps its effective dates; ended assignments are never erased." />
            <div className="card-pad">
              {assignments.length === 0 ? (
                <p className="cell-sub">You have no post assignments. Your access is limited to your own applications and permitted notices.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Post</th>
                        <th>Scope</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <div className="cell-title">{postName(data, a.post_code)}</div>
                            <div className="cell-sub">{a.reason ?? '—'}</div>
                          </td>
                          <td>{assignmentScopeText(data, a)}</td>
                          <td>{formatDate(a.starts_at)}</td>
                          <td>{a.ends_at ? formatDate(a.ends_at) : '—'}</td>
                          <td>
                            <Chip tone={a.active ? 'success' : 'neutral'}>{a.active ? 'Active' : 'Ended'}</Chip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="What you can do right now" subtitle="Derived from your current, live assignments." />
            <div className="card-pad">
              {profile.kind === 'student' ? <Chip tone="neutral">Own applications and documents only</Chip> : null}
              {activeGrants.length === 0 ? (
                <p className="cell-sub" style={{ marginTop: 8 }}>No officer permissions are active.</p>
              ) : (
                <div className="stack sm">
                  {activeGrants.map((grant) => (
                    <div key={grant.assignment_id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: '0.86rem' }}>{grant.post.name}</strong>
                        <Chip tone="info">{humanise(grant.post.scope_type)} scope</Chip>
                      </div>
                      <div className="cell-sub" style={{ marginTop: 4 }}>
                        {grant.permissions.map((p) => PERMISSION_LABELS[p]?.label ?? p).join(' · ')}
                      </div>
                      <div className="cell-sub" style={{ marginTop: 2 }}>
                        Effective {formatDate(grant.starts_at)} → {grant.ends_at ? formatDate(grant.ends_at) : 'present'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <Alert tone="info">
                  When an assignment ends, the permissions above disappear immediately — including access to that
                  post’s application history. Other independent assignments keep working.
                </Alert>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Change password" subtitle="Your password is never visible to administrators." />
            <div className="card-pad">
              {error ? <div style={{ marginBottom: 12 }}><Alert tone="danger">{error}</Alert></div> : null}
              <form onSubmit={changePassword} noValidate>
                <Field label="Current password" htmlFor="current-password">
                  <TextInput id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </Field>
                <Field label="New password" htmlFor="profile-new-password" hint="At least 10 characters with upper case, lower case and a number.">
                  <TextInput id="profile-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </Field>
                <Field label="Confirm new password" htmlFor="profile-confirm-password">
                  <TextInput id="profile-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </Field>
                <Button type="submit" loading={busy} disabled={!currentPassword || !newPassword}>
                  <Icon.Lock size={15} /> Update password
                </Button>
              </form>
            </div>
          </Card>

          <Card>
            <CardHeader title="Session" />
            <div className="card-pad">
              <p className="cell-sub">
                Signed in as <strong>{profile.email}</strong>. The prototype session ends automatically after 12 hours.
              </p>
              <div className="row" style={{ marginTop: 12 }}>
                <Button variant="secondary" onClick={() => backend.signOut()}>
                  <Icon.Logout size={15} /> Sign out
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
