import { useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, StatusChip, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { formatDate, humanise } from '../../lib/format';
import type { Batch, BatchStatus, Department, Faculty, Section } from '../../../domain/types';

type Editor =
  | { kind: 'faculty'; item?: Faculty }
  | { kind: 'department'; item?: Department }
  | { kind: 'batch'; item?: Batch }
  | { kind: 'section'; batch: Batch; item?: Section }
  | null;

export function StructureTab() {
  const { data, backend, notify } = useApp();
  const [editor, setEditor] = useState<Editor>(null);

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
      <Alert tone="info" title="No semester setup.">
        The academic hierarchy is faculty → department → batch → section. New batches are independent; archiving one
        never changes another.
      </Alert>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>Faculties</h3>
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
              {data.faculties.map((faculty) => (
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
        </div>
      </section>

      <section>
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>Departments</h3>
          <Button size="small" onClick={() => setEditor({ kind: 'department' })} disabled={!data.faculties.length}>
            <Icon.Plus size={14} /> Add department
          </Button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Department</th><th>Code</th><th>Faculty</th><th>Batches</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.departments.map((dept) => (
                <tr key={dept.id}>
                  <td className="cell-title">{dept.name}</td>
                  <td className="mono">{dept.code}</td>
                  <td>{data.faculties.find((f) => f.id === dept.faculty_id)?.name ?? '—'}</td>
                  <td>{data.batches.filter((b) => b.department_id === dept.id).length}</td>
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
          <h3 style={{ flex: 1 }}>Batches</h3>
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
              {data.batches.map((batch) => {
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
