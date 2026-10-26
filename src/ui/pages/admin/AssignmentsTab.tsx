import { useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, TextArea, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp, useSession } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { assignmentScopeText, postName } from '../../lib/selectors';
import type { Post, Scope } from '../../../domain/types';

export function AssignmentsTab() {
  const { data, backend, notify } = useApp();
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const active = data.assignments.filter((a) => a.active);
  const ended = data.assignments.filter((a) => !a.active).sort((a, b) => ((a.ends_at ?? '') < (b.ends_at ?? '') ? 1 : -1));

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ flex: 1 }}>Post assignments</h3>
        <Button size="small" onClick={() => setAssigning(true)}>
          <Icon.Plus size={14} /> Assign a post
        </Button>
      </div>

      <Alert tone="info" title="One post, one scope, one current holder.">
        Assigning a new holder to a post that already has one ends the previous assignment immediately (with a reason
        recorded) and notifies both people. The former holder keeps their account; only the access derived from that post
        is revoked.
      </Alert>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Post</th><th>Holder</th><th>Scope</th><th>Effective from</th><th>Reason</th><th /></tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="cell-title">{postName(data, a.post_code)}</div>
                  <div className="cell-sub mono">{a.post_code}</div>
                </td>
                <td>
                  <div>{data.profiles.find((p) => p.id === a.user_id)?.full_name ?? a.user_id}</div>
                  <div className="cell-sub">{data.profiles.find((p) => p.id === a.user_id)?.user_code}</div>
                </td>
                <td>{assignmentScopeText(data, a)}</td>
                <td>{formatDate(a.starts_at)}</td>
                <td className="cell-sub">{a.reason ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setEnding(a.id);
                      setReason('');
                    }}
                  >
                    End assignment
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h3 style={{ marginBottom: 10 }}>Assignment history</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Post</th><th>Holder</th><th>Scope</th><th>Period</th><th>Ended because</th></tr>
            </thead>
            <tbody>
              {ended.length === 0 ? (
                <tr><td colSpan={5} className="cell-sub">No ended assignments yet.</td></tr>
              ) : (
                ended.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-title">{postName(data, a.post_code)}</td>
                    <td>{data.profiles.find((p) => p.id === a.user_id)?.full_name ?? a.user_id}</td>
                    <td>{assignmentScopeText(data, a)}</td>
                    <td className="cell-sub">
                      {formatDate(a.starts_at)} → {formatDate(a.ends_at)}
                    </td>
                    <td className="cell-sub">{a.ended_reason ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>
          History is preserved. Application decisions recorded by these holders remain attributed to them and stay visible
          to the current holder of the same post and scope.
        </p>
      </section>

      {assigning ? (
        <AssignModal
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            notify('Post assigned. Pending work moved to the new holder automatically.', 'success');
          }}
          notify={notify}
        />
      ) : null}

      {ending ? (
        <Modal
          open
          onClose={() => setEnding(null)}
          title="End this assignment"
          footer={
            <>
              <Button variant="secondary" onClick={() => setEnding(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={reason.trim().length < 5}
                onClick={() => {
                  try {
                    backend.endAssignment(ending, reason);
                    notify('Assignment ended. Access from that post is revoked immediately.', 'info');
                    setEnding(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                End assignment
              </Button>
            </>
          }
        >
          <Alert tone="warn" title="Access is revoked immediately.">
            The holder will lose access to this post’s applications, history and documents. Pending applications stay
            with the post for the next holder.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="Reason (recorded in the audit log)" htmlFor="end-reason" required>
              <TextArea id="end-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Handover to the newly appointed Head of Department" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function AssignModal({
  onClose,
  onSaved,
  notify,
}: {
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string, t?: 'info' | 'success' | 'error') => void;
}) {
  const { data, backend } = useApp();
  const staff = data.profiles.filter((p) => p.kind !== 'student' && p.status !== 'suspended');
  const [userId, setUserId] = useState(staff[0]?.id ?? '');
  const [postCode, setPostCode] = useState(data.posts.find((p) => p.active)?.code ?? '');
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');

  const post: Post | undefined = data.posts.find((p) => p.code === postCode);
  const [scope, setScope] = useState<Scope>({});

  const facultyId = scope.faculty_id ?? '';
  const departmentId = scope.department_id ?? '';
  const batchId = scope.batch_id ?? '';
  const sectionId = scope.section_id ?? '';

  const departments = data.departments.filter((d) => !d.archived && (!facultyId || d.faculty_id === facultyId));
  const batches = data.batches.filter((b) => b.status !== 'deleted' && (!departmentId || b.department_id === departmentId));
  const sections = data.sections.filter((s) => s.batch_id === batchId);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Assign a post"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                backend.saveAssignment({
                  user_id: userId,
                  post_code: postCode,
                  scope,
                  starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
                  reason,
                });
                onSaved();
              } catch (err) {
                notify(errorMessage(err), 'error');
              }
            }}
            disabled={!userId || !postCode}
          >
            Assign post
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Person" htmlFor="assign-user" required>
          <Select id="assign-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name} ({p.user_code})</option>
            ))}
          </Select>
        </Field>
        <Field label="Post" htmlFor="assign-post" required>
          <Select id="assign-post" value={postCode} onChange={(e) => { setPostCode(e.target.value); setScope({}); }}>
            {data.posts.filter((p) => p.active).map((p) => (
              <option key={p.code} value={p.code}>{p.name} ({p.scope_type})</option>
            ))}
          </Select>
        </Field>
        <Field label="Effective from" htmlFor="assign-start">
          <TextInput id="assign-start" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Reason / note" htmlFor="assign-reason">
          <TextInput id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Initial appointment" />
        </Field>
      </div>

      <fieldset>
        <legend>Organisational scope for {post?.name ?? 'this post'}</legend>
        {post?.scope_type === 'university' ? (
          <p className="cell-sub">This post covers the whole university — no further scope is needed.</p>
        ) : null}
        <div className="form-grid">
          {(post?.scope_type === 'faculty' || post?.scope_type === 'department' || post?.scope_type === 'batch' || post?.scope_type === 'section') ? (
            <Field label="Faculty" htmlFor="scope-faculty" required>
              <Select
                id="scope-faculty"
                value={facultyId}
                onChange={(e) => setScope({ faculty_id: e.target.value || null })}
              >
                <option value="">Select faculty…</option>
                {data.faculties.filter((f) => !f.archived).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {(post?.scope_type === 'department' || post?.scope_type === 'batch' || post?.scope_type === 'section') ? (
            <Field label="Department" htmlFor="scope-dept" required>
              <Select
                id="scope-dept"
                value={departmentId}
                onChange={(e) => {
                  const dept = data.departments.find((d) => d.id === e.target.value);
                  setScope({ faculty_id: dept?.faculty_id ?? (facultyId || null), department_id: e.target.value || null });
                }}
              >
                <option value="">Select department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {(post?.scope_type === 'batch' || post?.scope_type === 'section') ? (
            <Field label="Batch" htmlFor="scope-batch" required>
              <Select
                id="scope-batch"
                value={batchId}
                onChange={(e) => {
                  const batch = data.batches.find((b) => b.id === e.target.value);
                  setScope({
                    faculty_id: facultyId || null,
                    department_id: batch?.department_id ?? (departmentId || null),
                    batch_id: e.target.value || null,
                  });
                }}
              >
                <option value="">Select batch…</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </Select>
            </Field>
          ) : null}
          {post?.scope_type === 'section' ? (
            <Field label="Section" htmlFor="scope-section" required>
              <Select
                id="scope-section"
                value={sectionId}
                onChange={(e) => setScope({ ...scope, section_id: e.target.value || null })}
              >
                <option value="">Select section…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>Section {s.name}</option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </fieldset>

      {post ? (
        <Alert tone="info" title={`${post.name} permissions`}>
          {post.permissions.join(' · ')}
        </Alert>
      ) : null}

      {data.assignments.some((a) => a.active && a.post_code === postCode && scopeCovers(a.scope, scope) && (post?.scope_type !== 'university')) ? (
        <div style={{ marginTop: 12 }}>
          <Alert tone="warn" title="This post already has a holder in that scope.">
            Saving will end the existing assignment ({formatDateTime(new Date().toISOString())}) and notify the former
            holder.
          </Alert>
        </div>
      ) : null}
    </Modal>
  );
}

function scopeCovers(a: Scope, b: Scope): boolean {
  if (b.section_id) return a.section_id === b.section_id;
  if (b.batch_id) return a.batch_id === b.batch_id;
  if (b.department_id) return a.department_id === b.department_id;
  if (b.faculty_id) return a.faculty_id === b.faculty_id;
  return false;
}

export function AssignmentChips() {
  const { data } = useApp();
  const session = useSession();
  return (
    <div className="row tight">
      {session.assignments.filter((a) => a.active).map((a) => (
        <Chip key={a.id} tone="info">{postName(data, a.post_code)}</Chip>
      ))}
    </div>
  );
}
