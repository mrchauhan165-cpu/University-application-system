import { useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { humanise } from '../../lib/format';
import type { ApplicantKind, ApplicationType, DocRequirement, FormField } from '../../../domain/types';

const FIELD_TYPES: FormField['type'][] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];
const RETENTION_CATEGORIES = ['standard', 'financial', 'disciplinary', 'legal', 'permanent'];

export function TypesTab() {
  const { data, backend, notify } = useApp();
  const [editing, setEditing] = useState<ApplicationType | 'new' | null>(null);

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ flex: 1 }}>Application types</h3>
        <Button size="small" onClick={() => setEditing('new')}>
          <Icon.Plus size={14} /> New type
        </Button>
      </div>

      <Alert tone="info" title="Types are fully configurable.">
        Each type defines who may apply, the fields, the required documents, confidentiality, the fallback approver and
        its retention category. Approval routes are configured in the Workflows tab.
      </Alert>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Type</th><th>Who may apply</th><th>Fields / docs</th><th>Confidential</th><th>Version</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {data.applicationTypes.map((type) => (
              <tr key={type.id}>
                <td>
                  <div className="cell-title">{type.name}</div>
                  <div className="cell-sub mono">{type.code}</div>
                </td>
                <td>{type.applicant_kinds.map((k) => humanise(k)).join(', ')}</td>
                <td className="cell-sub">
                  {type.fields.length} fields · {type.documents.length} docs
                  <div>{type.documents.filter((d) => d.required).length} required document(s)</div>
                </td>
                <td>{type.confidential ? <Chip tone="gold">Confidential</Chip> : <Chip tone="neutral">No</Chip>}</td>
                <td>v{type.version}</td>
                <td><Chip tone={type.active ? 'success' : 'neutral'}>{type.active ? 'Active' : 'Inactive'}</Chip></td>
                <td style={{ textAlign: 'right' }}>
                  <Button size="small" variant="secondary" onClick={() => setEditing(type)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <TypeEditor
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify('Application type saved. Existing applications keep their workflow version.', 'success');
          }}
          onError={(m) => notify(m, 'error')}
          save={(input) => backend.saveApplicationType(input)}
        />
      ) : null}
    </div>
  );
}

function TypeEditor({
  type,
  onClose,
  onSaved,
  onError,
  save,
}: {
  type?: ApplicationType;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  save: (input: Parameters<ReturnType<typeof useApp>['backend']['saveApplicationType']>[0]) => ApplicationType;
}) {
  const { data } = useApp();
  const [code, setCode] = useState(type?.code ?? '');
  const [name, setName] = useState(type?.name ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [kinds, setKinds] = useState<ApplicantKind[]>(type?.applicant_kinds ?? ['student']);
  const [confidential, setConfidential] = useState(type?.confidential ?? false);
  const [allowDraft, setAllowDraft] = useState(type?.allow_draft ?? true);
  const [allowWithdraw, setAllowWithdraw] = useState(type?.allow_withdraw ?? false);
  const [retention, setRetention] = useState(type?.retention_category ?? 'standard');
  const [fallback, setFallback] = useState(type?.fallback_approver_post ?? '');
  const [extraViewers, setExtraViewers] = useState<string[]>(type?.extra_viewer_posts ?? []);
  const [active, setActive] = useState(type?.active ?? true);
  const [fields, setFields] = useState<FormField[]>(type?.fields ?? []);
  const [documents, setDocuments] = useState<DocRequirement[]>(type?.documents ?? []);

  function toggleKind(kind: ApplicantKind) {
    setKinds((list) => (list.includes(kind) ? list.filter((k) => k !== kind) : [...list, kind]));
  }

  function patchField(index: number, patch: Partial<FormField>) {
    setFields((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function patchDoc(index: number, patch: Partial<DocRequirement>) {
    setDocuments((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New application type'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                save({
                  id: type?.id,
                  code,
                  name,
                  description,
                  applicant_kinds: kinds,
                  confidential,
                  allow_draft: allowDraft,
                  allow_withdraw: allowWithdraw,
                  fields,
                  documents,
                  retention_category: retention,
                  extra_viewer_posts: extraViewers,
                  fallback_approver_post: fallback || null,
                  active,
                });
                onSaved();
              } catch (err) {
                onError(errorMessage(err));
              }
            }}
          >
            Save type
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Type code" htmlFor="type-code" required hint="Upper case letters, digits, underscores.">
          <TextInput id="type-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Name" htmlFor="type-name" required>
          <TextInput id="type-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="type-desc" className="span-2">
          <TextInput id="type-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Retention category" htmlFor="type-retention">
          <Select id="type-retention" value={retention} onChange={(e) => setRetention(e.target.value)}>
            {RETENTION_CATEGORIES.map((r) => (
              <option key={r} value={r}>{humanise(r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fallback approver post" htmlFor="type-fallback" hint="Used only when every configured stage would be self-approval.">
          <Select id="type-fallback" value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">None</option>
            {data.posts.filter((p) => p.active && p.permissions.includes('application.act')).map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend>Who may apply</legend>
        <div className="row">
          {(['student', 'teacher', 'staff'] as ApplicantKind[]).map((kind) => (
            <label key={kind} className="checkbox">
              <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />
              <span>{humanise(kind)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Behaviour</legend>
        <div className="stack sm">
          <label className="checkbox">
            <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
            <span>Confidential — contents visible only to the officer currently acting (administrators cannot read it)</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={allowDraft} onChange={(e) => setAllowDraft(e.target.checked)} />
            <span>Applicants may save drafts</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={allowWithdraw} onChange={(e) => setAllowWithdraw(e.target.checked)} />
            <span>Applicants may withdraw while in progress</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Type is active and offered to the selected groups</span>
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Additional viewer posts (view-only)</legend>
        <div className="row tight">
          {data.posts.filter((p) => p.active).map((p) => (
            <label key={p.code} className="chip" style={{ cursor: 'pointer', background: extraViewers.includes(p.code) ? 'var(--blue-50)' : undefined }}>
              <input
                type="checkbox"
                checked={extraViewers.includes(p.code)}
                onChange={() =>
                  setExtraViewers((list) => (list.includes(p.code) ? list.filter((c) => c !== p.code) : [...list, p.code]))
                }
                style={{ width: 14, height: 14 }}
              />
              {p.name}
            </label>
          ))}
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>
          These posts may read (not act on) every application of this type in their own scope.
        </p>
      </fieldset>

      <fieldset>
        <legend>Form fields</legend>
        {fields.length === 0 ? <p className="cell-sub">No fields yet. At least one field is recommended.</p> : null}
        {fields.map((field, index) => (
          <div key={`${field.key}-${index}`} className="card" style={{ padding: 12, marginBottom: 8, boxShadow: 'none' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Field label="Key" htmlFor={`fkey-${index}`}>
                  <TextInput id={`fkey-${index}`} value={field.key} onChange={(e) => patchField(index, { key: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: 2, minWidth: 160 }}>
                <Field label="Label" htmlFor={`flabel-${index}`}>
                  <TextInput id={`flabel-${index}`} value={field.label} onChange={(e) => patchField(index, { label: e.target.value })} />
                </Field>
              </div>
              <div style={{ width: 130 }}>
                <Field label="Type" htmlFor={`ftype-${index}`}>
                  <Select
                    id={`ftype-${index}`}
                    value={field.type}
                    onChange={(e) => patchField(index, { type: e.target.value as FormField['type'] })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ width: 100 }}>
                <Field label="Required" htmlFor={`freq-${index}`}>
                  <Select
                    id={`freq-${index}`}
                    value={field.required ? 'yes' : 'no'}
                    onChange={(e) => patchField(index, { required: e.target.value === 'yes' })}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </Field>
              </div>
              <Button variant="ghost" size="small" onClick={() => setFields((list) => list.filter((_, i) => i !== index))}>
                <Icon.Trash size={14} />
              </Button>
            </div>
            {field.type === 'select' ? (
              <Field label="Options (comma separated)" htmlFor={`fopts-${index}`}>
                <TextInput
                  id={`fopts-${index}`}
                  value={(field.options ?? []).join(', ')}
                  onChange={(e) => patchField(index, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                />
              </Field>
            ) : null}
          </div>
        ))}
        <Button
          size="small"
          variant="secondary"
          onClick={() =>
            setFields((list) => [
              ...list,
              { key: `field_${list.length + 1}`, label: 'New field', type: 'text', required: false, max_length: 200 },
            ])
          }
        >
          <Icon.Plus size={13} /> Add field
        </Button>
      </fieldset>

      <fieldset>
        <legend>Required documents</legend>
        {documents.map((doc, index) => (
          <div key={`${doc.key}-${index}`} className="card" style={{ padding: 12, marginBottom: 8, boxShadow: 'none' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Field label="Key" htmlFor={`dkey-${index}`}>
                  <TextInput id={`dkey-${index}`} value={doc.key} onChange={(e) => patchDoc(index, { key: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: 2, minWidth: 160 }}>
                <Field label="Label" htmlFor={`dlabel-${index}`}>
                  <TextInput id={`dlabel-${index}`} value={doc.label} onChange={(e) => patchDoc(index, { label: e.target.value })} />
                </Field>
              </div>
              <div style={{ width: 100 }}>
                <Field label="Required" htmlFor={`dreq-${index}`}>
                  <Select
                    id={`dreq-${index}`}
                    value={doc.required ? 'yes' : 'no'}
                    onChange={(e) => patchDoc(index, { required: e.target.value === 'yes' })}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </Field>
              </div>
              <div style={{ width: 110 }}>
                <Field label="Max MB" htmlFor={`dmax-${index}`}>
                  <TextInput
                    id={`dmax-${index}`}
                    type="number"
                    value={doc.max_mb}
                    onChange={(e) => patchDoc(index, { max_mb: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Button variant="ghost" size="small" onClick={() => setDocuments((list) => list.filter((_, i) => i !== index))}>
                <Icon.Trash size={14} />
              </Button>
            </div>
            <Field label="Accepted file types (comma separated MIME types)" htmlFor={`dacc-${index}`}>
              <TextInput
                id={`dacc-${index}`}
                value={doc.accept.join(', ')}
                onChange={(e) => patchDoc(index, { accept: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
          </div>
        ))}
        <Button
          size="small"
          variant="secondary"
          onClick={() =>
            setDocuments((list) => [
              ...list,
              {
                key: `document_${list.length + 1}`,
                label: 'Supporting document',
                required: false,
                accept: ['application/pdf', 'image/png', 'image/jpeg'],
                max_mb: 2,
              },
            ])
          }
        >
          <Icon.Plus size={13} /> Add document requirement
        </Button>
      </fieldset>

      <Alert tone="info">
        Changing fields does not rewrite applications already submitted; they keep the values and workflow version they
        had at submission.
      </Alert>
    </Modal>
  );
}
