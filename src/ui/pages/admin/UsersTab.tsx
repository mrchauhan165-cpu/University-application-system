import { useMemo, useState } from 'react';
import { Alert, Button, Card, Chip, CopyButton, Field, Modal, Select, StatusChip, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { formatDate, humanise } from '../../lib/format';
import type { Profile, UserKind } from '../../../domain/types';

export function UsersTab() {
  const { data, backend, notify } = useApp();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [activation, setActivation] = useState<{ name: string; link: string } | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.profiles.filter((p) => {
      if (kindFilter && p.kind !== kindFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q && !`${p.full_name} ${p.email} ${p.user_code} ${p.roll_no ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.profiles, query, kindFilter, statusFilter]);

  async function invite(profileId: string, name: string) {
    try {
      const token = await backend.createActivation(profileId);
      const link = `${window.location.origin}${window.location.pathname}#/activate?token=${token.token}`;
      setActivation({ name, link });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ flex: 1 }}>Accounts</h3>
        <Button size="small" onClick={() => setCreating(true)}>
          <Icon.Plus size={14} /> Create account
        </Button>
      </div>

      <Alert tone="info" title="Accounts are not post assignments.">
        Creating an account gives a person a login. Access to applications comes only from an active post assignment.
        Passwords are never shown — invite links let each person set their own.
      </Alert>

      <div className="filters">
        <Field label="Search" htmlFor="user-search" className="grow">
          <TextInput id="user-search" type="search" placeholder="Name, email or user code" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field label="Group" htmlFor="user-kind">
          <Select id="user-kind" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All groups</option>
            <option value="student">Students</option>
            <option value="teacher">Teachers</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="user-status">
          <Select id="user-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </Select>
        </Field>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Person</th><th>Group</th><th>Department / batch</th><th>Status</th><th>Last sign-in</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const dept = data.departments.find((d) => d.id === (p.kind === 'student' ? p.department_id : p.home_department_id));
              const batch = data.batches.find((b) => b.id === p.batch_id);
              const section = data.sections.find((s) => s.id === p.section_id);
              return (
                <tr key={p.id}>
                  <td>
                    <div className="cell-title">{p.full_name}</div>
                    <div className="cell-sub mono">{p.user_code}</div>
                    <div className="cell-sub">{p.email}</div>
                  </td>
                  <td><Chip tone="neutral">{humanise(p.kind)}</Chip></td>
                  <td>
                    <div style={{ fontSize: '0.83rem' }}>{dept?.name ?? '—'}</div>
                    {batch ? <div className="cell-sub">{batch.label}{section ? ` · ${section.name}` : ''}</div> : null}
                  </td>
                  <td><StatusChip status={p.status} label={humanise(p.status)} /></td>
                  <td className="cell-sub">{p.last_login_at ? formatDate(p.last_login_at) : 'Never'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                      {p.status === 'invited' ? (
                        <Button size="small" onClick={() => void invite(p.id, p.full_name)}>Invite link</Button>
                      ) : null}
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => {
                          try {
                            void invite(p.id, p.full_name);
                          } catch (err) {
                            notify(errorMessage(err), 'error');
                          }
                        }}
                      >
                        Reset link
                      </Button>
                      {p.status === 'active' ? (
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            if (!window.confirm(`Suspend ${p.full_name}? Their live post assignments end immediately and sessions are revoked.`)) return;
                            try {
                              backend.setUserStatus(p.id, 'suspended');
                              notify('Account suspended and assignments ended.', 'info');
                            } catch (err) {
                              notify(errorMessage(err), 'error');
                            }
                          }}
                        >
                          Suspend
                        </Button>
                      ) : p.status === 'suspended' ? (
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            try {
                              backend.setUserStatus(p.id, 'active');
                              notify('Account reactivated. Previous assignments are not restored automatically.', 'success');
                            } catch (err) {
                              notify(errorMessage(err), 'error');
                            }
                          }}
                        >
                          Reactivate
                        </Button>
                      ) : null}
                      <Button size="small" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="cell-sub">No accounts match these filters.</p> : null}

      {creating ? (
        <UserEditor
          onClose={() => setCreating(false)}
          onCreated={(profile) => {
            setCreating(false);
            notify(`Account ${profile.user_code} created. Use “Invite link” to activate it.`, 'success');
          }}
          notify={notify}
        />
      ) : null}

      {editing ? (
        <UserEditor
          existing={editing}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            notify('Account updated.', 'success');
          }}
          notify={notify}
        />
      ) : null}

      {activation ? (
        <Modal
          open
          onClose={() => setActivation(null)}
          title="Activation link"
          footer={<Button onClick={() => setActivation(null)}>Done</Button>}
        >
          <Alert tone="warn" title="Share privately.">
            In production this single-use link is delivered by the auth provider (email) and expires quickly. It is
            shown here because the prototype has no email service configured.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="Link for this person" htmlFor="activation-link">
              <TextInput id="activation-link" readOnly value={activation.link} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <div className="row">
              <CopyButton value={activation.link} />
              <Button variant="secondary" size="small" onClick={() => window.open(activation.link, '_blank', 'noopener')}>
                Open link
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function UserEditor({
  existing,
  onClose,
  onCreated,
  notify,
}: {
  existing?: Profile;
  onClose: () => void;
  onCreated: (profile: Profile) => void;
  notify: (m: string, t?: 'info' | 'success' | 'error') => void;
}) {
  const { data, backend } = useApp();
  const [kind, setKind] = useState<UserKind>(existing?.kind ?? 'student');
  const [fullName, setFullName] = useState(existing?.full_name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [departmentId, setDepartmentId] = useState(
    existing?.department_id ?? existing?.home_department_id ?? data.departments[0]?.id ?? '',
  );
  const departments = data.departments.filter((d) => !d.archived);
  const batches = data.batches.filter((b) => b.department_id === departmentId && b.status !== 'deleted');
  const [batchId, setBatchId] = useState(existing?.batch_id ?? '');
  const sections = data.sections.filter((s) => s.batch_id === batchId);
  const [sectionId, setSectionId] = useState(existing?.section_id ?? '');
  const [designation, setDesignation] = useState(existing?.designation ?? '');
  const [rollNo, setRollNo] = useState(existing?.roll_no ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={existing ? `Edit ${existing.full_name}` : 'Create an account'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                const result = backend.saveUser({
                  id: existing?.id,
                  full_name: fullName,
                  email,
                  kind,
                  department_id: departmentId,
                  batch_id: kind === 'student' ? batchId || null : null,
                  section_id: kind === 'student' ? sectionId || null : null,
                  roll_no: kind === 'student' ? rollNo : null,
                  designation: kind === 'student' ? null : designation,
                  phone,
                });
                onCreated(result.profile);
              } catch (err) {
                notify(errorMessage(err), 'error');
              }
            }}
          >
            {existing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Group" htmlFor="u-kind">
          <Select
            id="u-kind"
            value={kind}
            disabled={Boolean(existing)}
            onChange={(e) => setKind(e.target.value as UserKind)}
          >
            <option value="student">Student</option>
            <option value="teacher">Teacher / faculty</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        <Field label="Full name" htmlFor="u-name" required>
          <TextInput id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email address" htmlFor="u-email" required hint="Used to sign in. Must be unique.">
          <TextInput id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone (optional)" htmlFor="u-phone">
          <TextInput id="u-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Department" htmlFor="u-dept" required>
          <Select
            id="u-dept"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setBatchId('');
              setSectionId('');
            }}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        {kind === 'student' ? (
          <>
            <Field label="Batch" htmlFor="u-batch" required>
              <Select
                id="u-batch"
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  setSectionId('');
                }}
              >
                <option value="">Select batch…</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Section" htmlFor="u-section" hint="Optional — can be set later.">
              <Select id="u-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">Not assigned</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>Section {s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Roll number" htmlFor="u-roll">
              <TextInput id="u-roll" value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Designation" htmlFor="u-designation">
            <TextInput id="u-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
        )}
      </div>

      {!existing ? (
        <Card>
          <div className="card-pad" style={{ fontSize: '0.84rem', color: 'var(--muted)' }}>
            <div className="row" style={{ gap: 8 }}><Icon.Lock size={14} /> No password is set here.</div>
            <div className="row" style={{ gap: 8, marginTop: 6 }}><Icon.Send size={14} /> After creating the account, use “Invite link” so the person sets their own password.</div>
            <div className="row" style={{ gap: 8, marginTop: 6 }}><Icon.Shield size={14} /> Assign a post from “Post assignments” to grant officer access.</div>
          </div>
        </Card>
      ) : (
        <Alert tone="info">
          Changing a person’s department or section preserves their identity. Post assignments are managed separately and
          are not changed here.
        </Alert>
      )}
    </Modal>
  );
}
