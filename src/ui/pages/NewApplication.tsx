import { useMemo, useState } from 'react';
import { useApp, navigate, useSession } from '../context';
import { Alert, Button, Card, CardHeader, Chip, Field, PageHeader, Select, TextArea, TextInput } from '../components/UI';
import { Icon } from '../components/Icons';
import { typeById, documentsOf, typeName } from '../lib/selectors';
import { bytes, humanise } from '../lib/format';
import { errorMessage } from '../../backend/errors';
import type { Application, ApplicationType, DocRequirement, FormField } from '../../domain/types';

export function NewApplicationPage() {
  const { data, route, notify } = useApp();
  const session = useSession();
  const [typeId, setTypeId] = useState<string | null>(route.query.get('type'));
  const [query, setQuery] = useState('');

  const types = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.applicationTypes
      .filter((t) => t.active)
      .filter((t) => t.applicant_kinds.includes(session.profile.kind))
      .filter((t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q));
  }, [data.applicationTypes, query, session.profile.kind]);

  const selected = typeById(data, typeId);

  if (typeId && !selected) {
    return (
      <>
        <PageHeader title="Application type unavailable" breadcrumbs={[{ label: 'New application', to: '/applications/new' }]} />
        <Alert tone="warn">This application type is no longer open to you. Choose another type.</Alert>
        <Button variant="secondary" style={{ marginTop: 12 }} onClick={() => setTypeId(null)}>
          Back to types
        </Button>
      </>
    );
  }

  if (selected) {
    return (
      <ApplicationForm
        type={selected}
        onCancel={() => navigate('/applications/new')}
        onSubmitted={(id) => {
          notify('Application submitted. Your reference number is shown on the next screen.', 'success');
          navigate(`/applications/${id}`);
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Start a new application"
        subtitle="Choose the type of application. Only types enabled for your group are listed."
        breadcrumbs={[{ label: 'My applications', to: '/applications' }, { label: 'New application' }]}
      />
      <Card>
        <div className="card-pad">
          <Field label="Search types" htmlFor="type-search">
            <TextInput
              id="type-search"
              type="search"
              placeholder="e.g. leave, bonafide, reimbursement"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {types.length === 0 ? (
        <Alert tone="info" title="No application types available">
          Nothing is currently open to your group. Contact the university office if you believe this is wrong.
        </Alert>
      ) : (
        <div className="type-grid">
          {types.map((type) => (
            <button
              key={type.id}
              type="button"
              className="type-card"
              onClick={() => {
                setTypeId(type.id);
                navigate(`/applications/new?type=${encodeURIComponent(type.id)}`);
              }}
            >
              <div className="type-card-top">
                <span className="type-icon"><Icon.File size={18} /></span>
                <strong>{type.name}</strong>
                {type.confidential ? <Chip tone="gold"><Icon.Lock size={11} /> Confidential</Chip> : null}
              </div>
              <p>{type.description}</p>
              <div className="type-card-meta">
                <span>{type.documents.length ? `${type.documents.length} document${type.documents.length === 1 ? '' : 's'}` : 'No documents'}</span>
                <span>{type.allow_withdraw ? 'Withdrawable' : 'Final once submitted'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ApplicationForm({
  type,
  onCancel,
  onSubmitted,
}: {
  type: ApplicationType;
  onCancel: () => void;
  onSubmitted: (id: string) => void;
}) {
  const { data, backend, notify } = useApp();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const docs = draftId ? documentsOf(data, draftId) : [];

  function setValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function ensureDraft(): string {
    if (draftId) {
      backend.updateDraft(draftId, values);
      return draftId;
    }
    const app = backend.createDraft(type.id, values);
    setDraftId(app.id);
    return app.id;
  }

  function handleError(err: unknown) {
    const fields = (err as { details?: { fields?: Record<string, string> } }).details?.fields;
    if (fields) setErrors(fields);
    notify(errorMessage(err), 'error');
  }

  function saveDraft() {
    setBusy('draft');
    try {
      const id = ensureDraft();
      notify('Draft saved. You can continue later from My applications.', 'success');
      navigate(`/applications/${id}`);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  function submit() {
    setBusy('submit');
    try {
      const missing = type.documents.filter((d) => d.required && !docs.some((doc) => doc.doc_key === d.key));
      if (missing.length) {
        setUploadError(`Attach the required document(s): ${missing.map((m) => m.label).join(', ')}.`);
        return;
      }
      const id = ensureDraft();
      backend.submit(id);
      onSubmitted(id);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function upload(doc: DocRequirement, file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(doc.key);
    try {
      const id = ensureDraft();
      await backend.uploadDocument(id, doc.key, file);
      notify(`${doc.label} attached.`, 'success');
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  return (
    <>
      <PageHeader
        title={type.name}
        subtitle={type.description}
        breadcrumbs={[{ label: 'New application', to: '/applications/new' }, { label: type.name }]}
        actions={<Chip tone={type.confidential ? 'gold' : 'neutral'}>{type.confidential ? 'Confidential' : 'Standard'}</Chip>}
      />
      {draftId ? (
        <div className="mb">
          <Alert tone="info">Draft saved. The reference number is issued when you submit.</Alert>
        </div>
      ) : null}

      <form
        className="split"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Card>
          <CardHeader title="Application details" subtitle="Fields marked * are required." />
          <div className="card-pad">
            <div className="form-grid">
              {type.fields.map((field) => (
                <FormFieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  error={errors[field.key]}
                  onChange={(v) => setValue(field.key, v)}
                />
              ))}
            </div>
          </div>
        </Card>

        <div className="stack">
          <Card>
            <CardHeader title="Documents" subtitle="Uploads are private and permission checked." />
            <div className="card-pad stack">
              {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}
              {type.documents.length === 0 ? (
                <p className="cell-sub">No documents are required for this type.</p>
              ) : null}
              {type.documents.map((doc) => {
                const attached = docs.find((d) => d.doc_key === doc.key);
                return (
                  <div key={doc.key} className="doc-upload">
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                        {doc.label} {doc.required ? <span className="req">*</span> : null}
                      </div>
                      <div className="cell-sub">
                        {doc.accept.map((a) => a.split('/')[1]?.toUpperCase()).join(', ')} · max {doc.max_mb} MB
                      </div>
                    </div>
                    {attached ? (
                      <div className="row tight">
                        <Chip tone="success"><Icon.Check size={12} /> {attached.file_name}</Chip>
                        <Button size="small" variant="ghost" onClick={() => { try { backend.removeDocument(attached.id); } catch (err) { notify(errorMessage(err), 'error'); } }}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <label className={`btn secondary small ${uploading === doc.key ? 'loading' : ''}`}>
                        {uploading === doc.key ? 'Uploading…' : 'Choose file'}
                        <input
                          type="file"
                          accept={doc.accept.join(',')}
                          className="sr-only"
                          disabled={uploading !== null}
                          onChange={(e) => {
                            void upload(doc, e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
              <p className="cell-sub">
                Files are stored privately. Executable files are rejected and every download re-checks your permission.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Before you submit" />
            <div className="card-pad stack sm">
              <p className="cell-sub">
                This goes to{' '}
                <strong>{data.workflows.find((w) => w.application_type_id === type.id && w.status === 'active')?.stages.map((s) => data.posts.find((p) => p.code === s.post_code)?.name ?? s.post_code).join(' → ') ?? 'the configured approver'}</strong>.
              </p>
              <p className="cell-sub">
                You can track progress under My applications. You will be notified at each stage.
              </p>
              {type.allow_withdraw ? <p className="cell-sub">You may withdraw while it is in progress.</p> : null}
            </div>
            <div className="card-pad row" style={{ borderTop: '1px solid var(--line)' }}>
              <Button type="submit" loading={busy === 'submit'} disabled={busy !== null}>
                <Icon.Send size={16} /> Submit application
              </Button>
              {type.allow_draft ? (
                <Button type="button" variant="secondary" onClick={saveDraft} loading={busy === 'draft'} disabled={busy !== null}>
                  Save draft
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={onCancel} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}

export function FormFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const id = `field-${field.key}`;
  const wide = field.type === 'textarea';
  const common = { id, invalid: Boolean(error), 'aria-describedby': error ? `${id}-err` : undefined };
  return (
    <Field label={field.label} htmlFor={id} required={field.required} error={error} className={wide ? 'span-2' : undefined}>
      {field.type === 'textarea' ? (
        <TextArea {...common} value={String(value ?? '')} maxLength={field.max_length} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === 'select' ? (
        <Select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      ) : field.type === 'checkbox' ? (
        <label className="checkbox" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      ) : (
        <TextInput
          {...common}
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          maxLength={field.max_length}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </Field>
  );
}

export function TypeSummaryChip({ typeId, fallback }: { typeId: string; fallback?: string }) {
  const { data } = useApp();
  const type = typeById(data, typeId);
  return <Chip tone="neutral">{type ? typeName(data, type.id) : fallback ?? 'Application'}</Chip>;
}

export type NewApplicationDraft = Pick<Application, 'id' | 'reference'>;
export const documentSizeLabel = (n: number) => bytes(n);
export const kindLabel = (k: string) => humanise(k);
export { useSession };
