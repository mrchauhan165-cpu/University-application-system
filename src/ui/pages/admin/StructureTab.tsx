import { useState } from 'react';
import { Alert, Button, Chip, CopyButton, Field, Modal, Select, StatusChip, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { formatDate, humanise } from '../../lib/format';
import type { Batch, BatchStatus, Department, Faculty, Profile, Section } from '../../../domain/types';

type Editor =
  | { kind: 'faculty'; item?: Faculty }
  | { kind: 'department'; item?: Department }
  | { kind: 'batch'; item?: Batch }
  | { kind: 'section'; batch: Batch; item?: Section }
  | { kind: 'teachers'; department: Department }
  | { kind: 'teacher'; department: Department }
  | { kind: 'move'; profile: Profile }
  | null;

export function StructureTab() {
  const { data, backend, notify } = useApp();
  const [editor, setEditor] = useState<Editor>(null);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = (...values: (string | null | undefined)[]) =>
    !q || values.some((v) => (v ?? '').toLowerCase().includes(q));
  const faculties = data.faculties.filter((f) => match(f.name, f.code));
  const departments = data.departments.filter((d) => {
    const faculty = data.faculties.find((f) => f.id === d.faculty_id);
    return match(d.name, d.code, faculty?.name);
  });
  const batches = data.batches.filter((b) => {
    const dept = data.departments.find((d) => d.id === b.department_id);
    return match(b.label, dept?.name);
  });

  const staffOf = (departmentId: string) =>
    data.profiles
      .filter((p) => p.kind !== 'student' && p.home_department_id === departmentId && p.status !== 'suspended')
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const [activation, setActivation] = useState<{ name: string; link: string } | null>(null);

  async function inviteTeacher(profile: Profile) {
    try {
      const token = await backend.createActivation(profile.id);
      const link = `${window.location.origin}${window.location.pathname}#/activate?token=${token.token}`;
      setActivation({ name: profile.full_name, link });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  function run(fn: () => void, success: string) {
    try {
      fn();
      notify(success, 'success');
      setEditor(null);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }

  return (
    <div className="stack">
      <Alert tone="info" title="Defaults are fully editable.">
        SGT University’s 19 faculties are pre-loaded as a starting point. Rename, add or archive any of them — nothing
        here is fixed. The academic hierarchy is faculty → department → batch → section, with no semester step.
      </Alert>

      <div className="filter-bar">
        <Field label="Find a faculty, department or batch" htmlFor="structure-search">
          <TextInput
            id="structure-search"
            type="search"
            placeholder="Type a name or code, e.g. Law, AYUR, CSE 2024"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        {q ? (
          <p className="cell-sub">
            Showing {faculties.length} of {data.faculties.length} faculties and {departments.length} of{' '}
            {data.departments.length} departments.
          </p>
        ) : null}
      </div>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>
            Faculties <span className="cell-sub">({data.faculties.length})</span>
          </h3>
          <Button size="small" onClick={() => setEditor({ kind: 'faculty' })}>
            <Icon.Plus size={14} /> Add faculty
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Faculty</th><th>Code</th><th>Departments</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {faculties.map((faculty) => (
                <tr key={faculty.id}>
                  <td className="cell-title">{faculty.name}</td>
                  <td className="mono">{faculty.code}</td>
                  <td>{data.departments.filter((d) => d.faculty_id === faculty.id).length}</td>
                  <td>
                    <Chip tone={faculty.archived ? 'neutral' : 'success'}>{faculty.archived ? 'Archived' : 'Active'}</Chip>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                      <Button size="small" variant="secondary" onClick={() => setEditor({ kind: 'faculty', item: faculty })}>Edit</Button>
                      {!faculty.archived ? (
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            if (!window.confirm(`Archive ${faculty.name}? This is recorded in the audit log.`)) return;
                            run(() => backend.archiveFaculty(faculty.id), 'Faculty archived.');
                          }}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {faculties.length === 0 ? <p className="cell-sub" style={{ padding: 14 }}>No faculty matches “{query}”.</p> : null}
        </div>
      </section>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>
            Departments <span className="cell-sub">({data.departments.length})</span>
          </h3>
          <Button size="small" onClick={() => setEditor({ kind: 'department' })} disabled={!data.faculties.length}>
            <Icon.Plus size={14} /> Add department
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Department</th>
                <th>Code</th>
                <th>Faculty</th>
                <th>Batches</th>
                <th>Teachers</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id}>
                  <td className="cell-title">{dept.name}</td>
                  <td className="mono">{dept.code}</td>
                  <td>{data.faculties.find((f) => f.id === dept.faculty_id)?.name ?? '—'}</td>
                  <td>{data.batches.filter((b) => b.department_id === dept.id).length}</td>
                  <td>
                    <div className="teacher-cell">
                      {(() => {
                        const staff = staffOf(dept.id);
                        return (
                          <>
                            <button
                              type="button"
                              className="teacher-chip"
                              title={`Show and move the teachers of ${dept.name}`}
                              onClick={() => setEditor({ kind: 'teachers', department: dept })}
                            >
                              <Icon.Users size={12} />
                              {staff.length ? `${staff.length} ${staff.length === 1 ? 'teacher' : 'teachers'}` : 'No teachers yet'}
                            </button>
                            {!dept.archived ? (
                              <Button size="small" variant="ghost" onClick={() => setEditor({ kind: 'teacher', department: dept })}>
                                <Icon.Plus size={12} /> Add
                              </Button>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td><Chip tone={dept.archived ? 'neutral' : 'success'}>{dept.archived ? 'Archived' : 'Active'}</Chip></td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                      <Button size="small" variant="secondary" onClick={() => setEditor({ kind: 'department', item: dept })}>Edit</Button>
                      {!dept.archived ? (
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            if (!window.confirm(`Archive ${dept.name}?`)) return;
                            run(() => backend.archiveDepartment(dept.id), 'Department archived.');
                          }}
                        >
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>
            Batches <span className="cell-sub">({data.batches.length})</span>
          </h3>
          <Button size="small" onClick={() => setEditor({ kind: 'batch' })} disabled={!data.departments.length}>
            <Icon.Plus size={14} /> Add batch
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Batch</th><th>Department</th><th>Years</th><th>Sections</th><th>Retention</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const sections = data.sections.filter((s) => s.batch_id === batch.id);
                return (
                  <tr key={batch.id}>
                    <td>
                      <div className="cell-title">{batch.label}</div>
                      <div className="cell-sub">{batch.graduated_on ? `Graduated ${formatDate(batch.graduated_on)}` : 'In progress'}</div>
                    </td>
                    <td>{data.departments.find((d) => d.id === batch.department_id)?.name ?? '—'}</td>
                    <td>{batch.start_year}–{batch.end_year}</td>
                    <td>
                      <div className="row tight">
                        {sections.length ? sections.map((s) => <Chip key={s.id} tone="neutral">{s.name}</Chip>) : <span className="cell-sub">None</span>}
                        <Button size="small" variant="ghost" onClick={() => setEditor({ kind: 'section', batch })}>
                          <Icon.Plus size={12} /> Section
                        </Button>
                      </div>
                    </td>
                    <td className="cell-sub">
                      {batch.retention_months} mc + {batch.final_months} mc
                    </td>
                    <td>
                      <Select
                        aria-label={`Status for ${batch.label}`}
                        value={batch.status}
                        onChange={(e) => {
                          const status = e.target.value as BatchStatus;
                          if (status === 'deleted') return;
                          if (!window.confirm(`Change ${batch.label} to “${humanise(status)}”?`)) return;
                          run(() => backend.setBatchStatus(batch.id, status), 'Batch status updated.');
                        }}
                      >
                        {(['upcoming', 'active', 'graduated', 'archived', 'retention_review', 'deletion_approval'] as BatchStatus[]).map((s) => (
                          <option key={s} value={s} disabled={batch.status === 'deleted'}>{humanise(s)}</option>
                        ))}
                        {batch.status === 'deleted' ? <option value="deleted">Deleted</option> : null}
                      </Select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="small" variant="secondary" onClick={() => setEditor({ kind: 'batch', item: batch })}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>
          Deleting a batch happens only through the retention workflow — it is not available here.
        </p>
      </section>

      {editor?.kind === 'faculty' ? (
        <EntityModal
          title={editor.item ? 'Edit faculty' : 'Add faculty'}
          onClose={() => setEditor(null)}
          onSave={(values) => run(() => backend.saveFaculty({ id: editor.item?.id, name: values.name, code: values.code }), 'Faculty saved.')}
          fields={[
            { key: 'name', label: 'Faculty name', placeholder: 'Faculty of Engineering' },
            { key: 'code', label: 'Code (2–12 characters)', placeholder: 'ENG' },
          ]}
          initial={{ name: editor.item?.name ?? '', code: editor.item?.code ?? '' }}
        />
      ) : null}

      {editor?.kind === 'department' ? (
        <EntityModal
          title={editor.item ? 'Edit department' : 'Add department'}
          onClose={() => setEditor(null)}
          onSave={(values) =>
            run(
              () => backend.saveDepartment({ id: editor.item?.id, faculty_id: values.faculty_id, name: values.name, code: values.code }),
              'Department saved.',
            )
          }
          fields={[
            { key: 'name', label: 'Department name', placeholder: 'Computer Science & Engineering' },
            { key: 'code', label: 'Code (2–12 characters)', placeholder: 'CSE' },
          ]}
          selectField={{
            key: 'faculty_id',
            label: 'Faculty',
            options: data.faculties.filter((f) => !f.archived).map((f) => ({ value: f.id, label: f.name })),
          }}
          initial={{ name: editor.item?.name ?? '', code: editor.item?.code ?? '', faculty_id: editor.item?.faculty_id ?? '' }}
        />
      ) : null}

      {editor?.kind === 'batch' ? (
        <BatchModal
          batch={editor.item}
          onClose={() => setEditor(null)}
          onSave={(values) =>
            run(
              () =>
                backend.saveBatch({
                  id: editor.item?.id,
                  department_id: values.department_id,
                  label: values.label,
                  start_year: Number(values.start_year),
                  end_year: Number(values.end_year),
                  retention_months: Number(values.retention_months),
                  final_months: Number(values.final_months),
                }),
              'Batch saved.',
            )
          }
        />
      ) : null}

      {editor?.kind === 'teachers' ? (
        <TeachersModal
          department={editor.department}
          onClose={() => setEditor(null)}
          onAdd={() => setEditor({ kind: 'teacher', department: (editor as { kind: 'teachers'; department: Department }).department })}
          onMove={(profile) => setEditor({ kind: 'move', profile })}
        />
      ) : null}

      {editor?.kind === 'teacher' ? (
        <TeacherModal
          department={editor.department}
          onClose={() => setEditor(null)}
          onCreated={(profile) => {
            setEditor(null);
            notify(`${profile.full_name} added to ${editor.department.name}. Share the invite link to activate the account.`, 'success');
            void inviteTeacher(profile);
          }}
          notify={notify}
        />
      ) : null}

      {editor?.kind === 'move' ? (
        <MoveTeacherModal
          profile={editor.profile}
          onClose={() => setEditor(null)}
          onMoved={(name, department) => {
            setEditor(null);
            notify(`${name} is now in ${department}. Everything follows automatically.`, 'success');
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
            Activation links are single-use and expire quickly. This prototype has no email service, so the link is
            shown here — copy it and send it to {activation.name}.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="Link for this teacher" htmlFor="teacher-activation-link">
              <TextInput id="teacher-activation-link" readOnly value={activation.link} onFocus={(e) => e.currentTarget.select()} />
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

      {editor?.kind === 'section' ? (
        <EntityModal
          title={`Add section to ${editor.batch.label}`}
          onClose={() => setEditor(null)}
          onSave={(values) =>
            run(
              () => backend.saveSection({ batch_id: editor.batch.id, name: values.name, capacity: values.capacity ? Number(values.capacity) : null }),
              'Section saved.',
            )
          }
          fields={[
            { key: 'name', label: 'Section name', placeholder: 'A' },
            { key: 'capacity', label: 'Capacity (optional)', placeholder: '60', type: 'number' },
          ]}
          initial={{ name: '', capacity: '' }}
        />
      ) : null}
    </div>
  );
}

function EntityModal({
  title,
  onClose,
  onSave,
  fields,
  selectField,
  initial,
}: {
  title: string;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
  fields: { key: string; label: string; placeholder?: string; type?: string }[];
  selectField?: { key: string; label: string; options: { value: string; label: string }[] };
  initial: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(values)}>Save</Button>
        </>
      }
    >
      {selectField ? (
        <Field label={selectField.label} htmlFor={`sel-${selectField.key}`} required>
          <Select
            id={`sel-${selectField.key}`}
            value={values[selectField.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [selectField.key]: e.target.value }))}
          >
            <option value="">Select…</option>
            {selectField.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      {fields.map((field) => (
        <Field key={field.key} label={field.label} htmlFor={`f-${field.key}`} required>
          <TextInput
            id={`f-${field.key}`}
            type={field.type ?? 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        </Field>
      ))}
    </Modal>
  );
}

function BatchModal({
  batch,
  onClose,
  onSave,
}: {
  batch?: Batch;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}) {
  const { data } = useApp();
  const [values, setValues] = useState<Record<string, string>>({
    department_id: batch?.department_id ?? data.departments[0]?.id ?? '',
    label: batch?.label ?? '',
    start_year: String(batch?.start_year ?? new Date().getFullYear()),
    end_year: String(batch?.end_year ?? new Date().getFullYear() + 4),
    retention_months: String(batch?.retention_months ?? data.settings.retention_months),
    final_months: String(batch?.final_months ?? data.settings.final_retention_months),
  });
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  return (
    <Modal
      open
      onClose={onClose}
      title={batch ? 'Edit batch' : 'Add batch'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(values)}>Save batch</Button>
        </>
      }
    >
      <Field label="Department" htmlFor="batch-dept" required>
        <Select id="batch-dept" value={values.department_id} onChange={(e) => set('department_id', e.target.value)}>
          {data.departments.filter((d) => !d.archived).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Batch label" htmlFor="batch-label" required hint="Unique within the department, e.g. “CSE 2025–2029”.">
        <TextInput id="batch-label" value={values.label} onChange={(e) => set('label', e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="Start year" htmlFor="batch-start" required>
          <TextInput id="batch-start" type="number" value={values.start_year} onChange={(e) => set('start_year', e.target.value)} />
        </Field>
        <Field label="Expected completion year" htmlFor="batch-end" required>
          <TextInput id="batch-end" type="number" value={values.end_year} onChange={(e) => set('end_year', e.target.value)} />
        </Field>
        <Field label="Initial cleanup after graduation (months)" htmlFor="batch-retention">
          <TextInput id="batch-retention" type="number" value={values.retention_months} onChange={(e) => set('retention_months', e.target.value)} />
        </Field>
        <Field label="Final deletion review after that (months)" htmlFor="batch-final">
          <TextInput id="batch-final" type="number" value={values.final_months} onChange={(e) => set('final_months', e.target.value)} />
        </Field>
      </div>
      <Alert tone="info">
        These periods are proposals only. Nothing is deleted automatically — a retention job needs a dry run and a
        second authorised approval.
      </Alert>
    </Modal>
  );
}

export function BatchStatusChip({ status }: { status: BatchStatus }) {
  return <StatusChip status={status} label={humanise(status)} />;
}

function TeacherModal({
  department,
  onClose,
  onCreated,
  notify,
}: {
  department: Department;
  onClose: () => void;
  onCreated: (profile: Profile) => void;
  notify: (m: string, t?: 'info' | 'success' | 'error') => void;
}) {
  const { data, backend } = useApp();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [designation, setDesignation] = useState('Assistant Professor');
  const [phone, setPhone] = useState('');
  const faculty = data.faculties.find((f) => f.id === department.faculty_id);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add a teacher to ${department.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                const result = backend.saveUser({
                  full_name: fullName,
                  email,
                  kind: 'teacher',
                  department_id: department.id,
                  designation,
                  phone,
                });
                onCreated(result.profile);
              } catch (err) {
                notify(errorMessage(err), 'error');
              }
            }}
          >
            Add teacher
          </Button>
        </>
      }
    >
      <Alert tone="info" title={`${department.name}${faculty ? ` · ${faculty.name}` : ''}`}>
        The teacher is created in this department straight away. Their account stays “invited” until they open the
        activation link and set a password.
      </Alert>
      <Field label="Full name" htmlFor="t-name" required>
        <TextInput id="t-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dr. Meera Iyer" />
      </Field>
      <Field label="Email address" htmlFor="t-email" required hint="Used to sign in. Must be unique.">
        <TextInput id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="meera.iyer@demo.university" />
      </Field>
      <Field label="Designation" htmlFor="t-designation">
        <TextInput id="t-designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
      </Field>
      <Field label="Phone (optional)" htmlFor="t-phone">
        <TextInput id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
    </Modal>
  );
}

function MoveTeacherModal({
  profile,
  onClose,
  onMoved,
  notify,
}: {
  profile: Profile;
  onClose: () => void;
  onMoved: (name: string, department: string) => void;
  notify: (m: string, t?: 'info' | 'success' | 'error') => void;
}) {
  const { data, backend } = useApp();
  const current = data.departments.find((d) => d.id === profile.home_department_id);
  const [departmentId, setDepartmentId] = useState('');
  const [reason, setReason] = useState('');
  const target = data.departments.find((d) => d.id === departmentId);
  const posts = data.assignments.filter((a) => a.user_id === profile.id && a.active);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Move ${profile.full_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!departmentId}
            onClick={() => {
              try {
                backend.changeUserDepartment({ user_id: profile.id, department_id: departmentId, reason: reason || null });
                onMoved(profile.full_name, target?.name ?? 'the new department');
              } catch (err) {
                notify(errorMessage(err), 'error');
              }
            }}
          >
            Move department
          </Button>
        </>
      }
    >
      <Alert tone="info" title={`Currently: ${current?.name ?? 'no department'}`}>
        The new department is used everywhere immediately — their applications, approvals queue and notices follow the
        change, and the move is written to the audit trail.
      </Alert>
      {posts.length ? (
        <Alert tone="warn" title="This person holds a post.">
          A live post keeps its own scope. If the post belongs to the old department, the move is refused until that
          post is handed over in <strong>Administration → Posts &amp; permissions</strong> — this stops a teacher
          keeping an old queue after moving.
        </Alert>
      ) : null}
      <Field label="New department" htmlFor="move-dept" required>
        <Select id="move-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">Select a department…</option>
          {data.faculties
            .filter((f) => !f.archived)
            .map((faculty) => {
              const options = data.departments.filter((d) => d.faculty_id === faculty.id && !d.archived && d.id !== profile.home_department_id);
              if (!options.length) return null;
              return (
                <optgroup key={faculty.id} label={faculty.name}>
                  {options.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </optgroup>
              );
            })}
        </Select>
      </Field>
      <Field label="Reason (optional, kept in the audit trail)" htmlFor="move-reason">
        <TextInput id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Department reorganisation, mutual transfer…" />
      </Field>
    </Modal>
  );
}

function TeachersModal({
  department,
  onClose,
  onAdd,
  onMove,
}: {
  department: Department;
  onClose: () => void;
  onAdd: () => void;
  onMove: (profile: Profile) => void;
}) {
  const { data } = useApp();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const faculty = data.faculties.find((f) => f.id === department.faculty_id);
  const staff = data.profiles
    .filter((p) => p.kind !== 'student' && p.home_department_id === department.id)
    .filter((p) => !q || `${p.full_name} ${p.designation ?? ''} ${p.user_code}`.toLowerCase().includes(q))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Teachers — ${department.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={onAdd}><Icon.Plus size={14} /> Add a teacher</Button>
        </>
      }
    >
      <Alert tone="info" title={faculty?.name ?? 'Department'}>
        Everyone whose home department is here. Moving someone updates their queue, notices and profile at once —
        a live post keeps its own scope, so it must be handed over first.
      </Alert>
      <Field label="Find a teacher" htmlFor="teacher-search">
        <TextInput id="teacher-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, designation or employee code" />
      </Field>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Code</th><th>Designation</th><th>Account</th><th /></tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <tr key={person.id}>
                <td className="cell-title">{person.full_name}</td>
                <td className="mono">{person.user_code}</td>
                <td className="cell-sub">{person.designation ?? '—'}</td>
                <td><Chip tone={person.status === 'active' ? 'success' : person.status === 'suspended' ? 'danger' : 'neutral'}>{humanise(person.status)}</Chip></td>
                <td style={{ textAlign: 'right' }}>
                  <Button size="small" variant="secondary" onClick={() => onMove(person)}>
                    <Icon.Swap size={13} /> Change department
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {staff.length === 0 ? (
        <p className="cell-sub" style={{ padding: 12 }}>
          {q ? `No teacher matches “${query}”.` : 'No teachers in this department yet — use “Add a teacher”.'}
        </p>
      ) : null}
    </Modal>
  );
}
