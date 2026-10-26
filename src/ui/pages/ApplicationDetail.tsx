import { useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  TextArea,
} from '../components/UI';
import { useApp, useSession, navigate } from '../context';
import { StageStepper, StatusHero } from '../components/Progress';
import { ApiError, errorMessage } from '../../backend/errors';
import { bytes, formatDate, formatDateTime, fromNow, humanise, initialLetters } from '../lib/format';
import {
  applicationOrgText,
  applicationSteps,
  canActOn,
  postName,
  workflowOf,
} from '../lib/selectors';
import { FormFieldInput } from './NewApplication';
import { DocumentViewer } from '../components/DocumentViewer';
import type { ActionType, Application, AppStatus } from '../../domain/types';
import { STATUS_LABEL } from '../../domain/types';

type ActionChoice = 'approve' | 'approve_forward' | 'finalise' | 'reject' | 'return' | 'clarify' | 'remark';

interface ActionOption {
  value: ActionChoice;
  label: string;
  hint: string;
  tone: 'primary' | 'secondary' | 'danger' | 'success';
}

function actionOptions(app: Application, workflow: ReturnType<typeof workflowOf>): ActionOption[] {
  if (!workflow) return [];
  const beyond = app.stage_index >= workflow.stages.length;
  const lastStage = !beyond && app.stage_index >= workflow.stages.length - 1;
  const beyondFinal = workflow.beyond_final;
  const common: ActionOption[] = [
    { value: 'reject', label: 'Reject', hint: 'Requires remarks that the applicant will see.', tone: 'danger' },
    { value: 'return', label: 'Return for correction', hint: 'The applicant can correct and resubmit.', tone: 'secondary' },
    { value: 'clarify', label: 'Request clarification', hint: 'Keeps the application at your stage.', tone: 'secondary' },
    { value: 'remark', label: 'Add remark only', hint: 'No status change. Choose whether the applicant sees it.', tone: 'secondary' },
  ];
  if (beyond) {
    const allowed = new Set<string>(beyondFinal ? beyondFinal.actions : ['finalise', 'reject', 'return']);
    const list: ActionOption[] = [];
    if (allowed.has('finalise')) {
      list.push({
        value: 'finalise',
        label: 'Approve / Finalise',
        hint: beyondFinal
          ? 'Completes the application as the configured higher authority.'
          : 'Completes the application.',
        tone: 'success',
      });
    }
    list.push(
      ...common.filter((c) => allowed.has(c.value) || c.value === 'remark' || c.value === 'clarify'),
    );
    return list;
  }
  if (lastStage) {
    if (beyondFinal) {
      return [
        {
          value: 'approve_forward',
          label: 'Approve and forward',
          hint: `Not a final approval. Sends the application to ${beyondFinal.label} for completion.`,
          tone: 'primary',
        },
        ...common,
      ];
    }
    return [
      { value: 'finalise', label: 'Approve / Finalise', hint: 'You are the final authority for this type.', tone: 'success' },
      ...common,
    ];
  }
  return [
    { value: 'approve', label: 'Approve and pass to next stage', hint: 'Moves the application to the next configured post.', tone: 'primary' },
    ...common,
  ];
}

export function ApplicationDetailPage({ appId }: { appId: string }) {
  const { data, backend, notify } = useApp();
  const session = useSession();
  const app = data.applications.find((a) => a.id === appId);
  const [actionOpen, setActionOpen] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  if (!app) {
    const exists = backend.peek().applications.find((a) => a.id === appId);
    return (
      <>
        <PageHeader title="Application unavailable" breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Applications' }]} />
        <Card>
          <EmptyState
            icon={<Icon.Lock size={22} />}
            title={exists ? 'You no longer have access to this application' : 'Application not found'}
            description={
              exists
                ? 'Access is based on your current post assignment and organisational scope. If a post assignment ended, access derived from it is revoked immediately — old links stop working.'
                : 'The link may be incorrect, or the record may have been removed under the retention policy.'
            }
            action={<Button onClick={() => navigate('/applications')}>Back to my applications</Button>}
          />
        </Card>
      </>
    );
  }

  const type = data.applicationTypes.find((t) => t.id === app.application_type_id);
  const workflow = workflowOf(data, app);
  const isApplicant = app.applicant_id === session.profile.id;
  const canAct = canActOn(data, session, app);
  const options = actionOptions(app, workflow);
  const docs = data.documents.filter((d) => d.application_id === app.id);
  const actions = data.actions
    .filter((a) => a.application_id === app.id)
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  const events = data.statusEvents
    .filter((e) => e.application_id === app.id)
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  const steps = applicationSteps(data, app);
  const nextPost = app.current_post ? postName(data, app.current_post) : null;

  return (
    <>
      <PageHeader
        title={type?.name ?? 'Application'}
        subtitle={
          <span>
            <span className="mono">{app.reference}</span> · {applicationOrgText(data, app)}
          </span>
        }
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: isApplicant ? 'My applications' : 'Inbox', to: isApplicant ? '/applications' : '/inbox' },
          { label: app.reference },
        ]}
        actions={
          <>
            <StatusChip status={app.status} label={STATUS_LABEL[app.status]} />
            {isApplicant && app.status === 'draft' ? (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                Continue editing
              </Button>
            ) : null}
            {isApplicant && app.status === 'returned' ? (
              <Button onClick={() => setEditOpen(true)}>
                <Icon.Undo size={15} /> Correct &amp; resubmit
              </Button>
            ) : null}
            {isApplicant && type?.allow_withdraw && ['submitted', 'under_review', 'resubmitted', 'returned'].includes(app.status) ? (
              <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>Withdraw</Button>
            ) : null}
          </>
        }
      />

      <StatusHero
        app={app}
        data={data}
        steps={steps}
        actions={
          isApplicant && app.status === 'returned' ? (
            <Button onClick={() => setEditOpen(true)}>
              <Icon.Undo size={15} /> Correct &amp; resubmit
            </Button>
          ) : canAct ? (
            <Button onClick={() => setActionOpen(true)}>
              <Icon.Shield size={15} /> Take action
            </Button>
          ) : isApplicant && app.status === 'draft' ? (
            <Button onClick={() => setEditOpen(true)}>Continue editing</Button>
          ) : undefined
        }
      />

      <div className="fact-strip">
        <Fact label="Applicant" value={`${app.applicant_name} (${app.applicant_code})`} />
        <Fact label="Organisation" value={applicationOrgText(data, app)} />
        <Fact label="Current stage" value={nextPost ?? 'Closed'} />
        <Fact label="Submitted" value={app.submitted_at ? formatDate(app.submitted_at) : 'Not submitted'} />
        <Fact label="Last update" value={fromNow(app.updated_at)} />
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <CardHeader
              title="Approval route"
              subtitle={workflow ? `Workflow version ${workflow.version} · fixed when the application was submitted` : 'Unavailable'}
              actions={
                <>
                  {app.confidential ? <Chip tone="gold">Confidential</Chip> : null}
                  <Chip tone={app.retention_category === 'standard' ? 'neutral' : 'warn'}>
                    {humanise(app.retention_category)} retention
                  </Chip>
                </>
              }
            />
            <div className="card-pad">
              <StageStepper steps={steps} />
              {workflow?.beyond_final && app.status === 'under_review' ? (
                <p className="cell-sub" style={{ marginTop: 14 }}>
                  <Icon.Info size={12} /> The last stage forwards to {workflow.beyond_final.label}. Forwarding is not a
                  final approval.
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Submitted details" subtitle="Values captured with this application." />
            <div className="card-pad">
              <dl className="kv">
                {(type?.fields ?? []).map((field) => {
                  const raw = app.data[field.key];
                  const value =
                    raw === null || raw === undefined || raw === ''
                      ? '—'
                      : field.type === 'checkbox'
                        ? raw
                          ? 'Yes'
                          : 'No'
                        : String(raw);
                  return (
                    <div key={field.key} style={{ display: 'contents' }}>
                      <dt>{field.label}</dt>
                      <dd>{value}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Documents" subtitle={docs.length ? `${docs.length} private file(s)` : 'No files attached'} />
            <div className="card-pad">
              {docs.length === 0 ? (
                <p className="cell-sub">No documents were attached to this application.</p>
              ) : (
                <div className="stack sm">
                  {docs.map((doc) => {
                    const requirement = type?.documents.find((d) => d.key === doc.doc_key);
                    return (
                      <div key={doc.id} className="row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                        <span className="stat-icon" style={{ width: 32, height: 32, flex: '0 0 32px' }}><Icon.File size={15} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{doc.file_name}</div>
                          <div className="cell-sub">
                            {requirement?.label ?? doc.doc_key} · {bytes(doc.size)} · uploaded {formatDate(doc.uploaded_at)}
                            {doc.replaces_id ? ' · replaces an earlier version' : ''}
                          </div>
                        </div>
                        <Button size="small" variant="secondary" onClick={() => setDocId(doc.id)}>
                          <Icon.Eye size={14} /> View
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="cell-sub" style={{ marginTop: 10 }}>
                <Icon.Lock size={12} /> Documents are private. Every view re-checks your current permission.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Status timeline" subtitle="The applicant-facing journey." />
            <div className="card-pad">
              {events.length === 0 ? (
                <p className="cell-sub">No status changes yet.</p>
              ) : (
                <ul className="timeline">
                  {events.map((e) => (
                    <li key={e.id} className={e.status === 'rejected' ? 'danger' : e.status === 'completed' ? 'success' : ['returned', 'further_pending'].includes(e.status) ? 'warn' : undefined}>
                      <div className="t-title">{e.label}</div>
                      <div className="t-meta">{formatDateTime(e.created_at)}</div>
                      {e.note ? <div className="t-note">{e.note}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Decisions & audit trail" subtitle="Who acted, in which post, and when. Prior decisions are never overwritten." />
            <div className="card-pad">
              {actions.length === 0 ? (
                <p className="cell-sub">No actions recorded yet.</p>
              ) : (
                <div className="stack sm">
                  {actions.map((a) => (
                    <div key={a.id} className="decision">
                      <span className="avatar sm" aria-hidden="true">{initialLetters(a.actor_name)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                          <span className="row tight">
                            <Chip tone={a.action === 'reject' ? 'danger' : a.action === 'return' ? 'warn' : a.action === 'finalise' || a.action === 'approve' ? 'success' : 'neutral'}>
                              {humanise(a.action)}
                            </Chip>
                            {a.from_status && a.from_status !== a.to_status ? (
                              <span className="cell-sub">
                                {STATUS_LABEL[a.from_status as AppStatus] ?? a.from_status} → {STATUS_LABEL[a.to_status] ?? a.to_status}
                              </span>
                            ) : null}
                          </span>
                          <span className="cell-sub">{formatDateTime(a.created_at)}</span>
                        </div>
                        <div className="cell-sub" style={{ marginTop: 4 }}>
                          {a.actor_name} ({a.actor_code}){a.post_name ? ` · ${a.post_name}` : ''}
                          {a.scope_label ? ` · ${a.scope_label}` : ''}
                        </div>
                        {a.remarks_applicant ? (
                          <div className="note note-applicant">
                            <strong>Visible to applicant</strong>
                            {a.remarks_applicant}
                          </div>
                        ) : null}
                        {a.remarks_internal ? (
                          <div className="note note-internal">
                            <strong><Icon.Lock size={11} /> Internal note</strong>
                            {a.remarks_internal}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          {canAct ? (
            <Card>
              <CardHeader
                title="Your decision"
                subtitle={`You are acting through your current post: ${postName(data, app.current_post)}`}
              />
              <div className="card-pad">
                {workflow && workflow.beyond_final && app.stage_index >= workflow.stages.length - 1 && !app.beyond_active ? (
                  <div style={{ marginBottom: 12 }}>
                    <Alert tone="warn" title="Two different approvals.">
                      <div style={{ marginTop: 6 }}>
                        <strong>Approve and forward</strong> sends this to {workflow.beyond_final.label} and keeps the
                        application pending — it is not a final approval.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        This type has a configured higher post, so “Approve / Finalise” is not available.
                      </div>
                    </Alert>
                  </div>
                ) : null}
                <Button block onClick={() => setActionOpen(true)}>
                  <Icon.Shield size={16} /> Take action on this application
                </Button>
                <div className="stack sm" style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--muted)' }}>
                  <span>• Your assignment is re-checked when the action is submitted.</span>
                  <span>• Self-approval is blocked by the backend.</span>
                  <span>• Remarks for the applicant are shown on their timeline.</span>
                </div>
              </div>
            </Card>
          ) : app.current_post && !isApplicant ? (
            <Card>
              <CardHeader title="Current stage" />
              <div className="card-pad">
                <p style={{ fontSize: '0.86rem', color: 'var(--muted)' }}>
                  This application is with <strong>{postName(data, app.current_post)}</strong>. You can read it only if
                  that post and scope are part of your current assignment.
                </p>
              </div>
            </Card>
          ) : null}

          {isApplicant ? (
            <Card>
              <CardHeader title="Your access" />
              <div className="card-pad stack sm" style={{ fontSize: '0.84rem' }}>
                <div className="row" style={{ gap: 8, color: 'var(--muted)' }}>
                  <Icon.CheckCircle size={14} /> You can always open your own application
                </div>
                <div className="row" style={{ gap: 8, color: 'var(--muted)' }}>
                  <Icon.Lock size={14} /> Internal officer notes stay hidden from you
                </div>
                <div className="row" style={{ gap: 8, color: 'var(--muted)' }}>
                  <Icon.Users size={14} /> Other applicants’ records are never shown
                </div>
                {app.status === 'draft' ? (
                  <Button variant="danger" size="small" onClick={() => {
                    if (!window.confirm('Delete this draft permanently?')) return;
                    try {
                      backend.deleteDraft(app.id);
                      notify('Draft deleted.', 'info');
                      navigate('/applications');
                    } catch (err) {
                      notify(errorMessage(err), 'error');
                    }
                  }}>
                    <Icon.Trash size={14} /> Delete draft
                  </Button>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Documents & privacy" />
            <div className="card-pad" style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              <div className="row" style={{ gap: 8 }}><Icon.Lock size={14} /> Private, permission-checked downloads</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}><Icon.Clock size={14} /> Correction versions are preserved</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}><Icon.Archive size={14} /> Retention category: {humanise(app.retention_category)}</div>
            </div>
          </Card>
        </div>
      </div>

      {actionOpen ? (
        <ActionModal
          app={app}
          options={options}
          onClose={() => setActionOpen(false)}
          onSubmit={(choice, remarks) => {
            try {
              backend.act(app.id, {
                action: choice.value,
                remarksApplicant: remarks.applicant,
                remarksInternal: remarks.internal,
                visibleToApplicant: remarks.visibleToApplicant,
              });
              notify('Action recorded and the relevant people were notified.', 'success');
              setActionOpen(false);
            } catch (err) {
              if (err instanceof ApiError) {
                notify(err.message, 'error');
              } else {
                notify(errorMessage(err), 'error');
              }
            }
          }}
        />
      ) : null}

      {docId ? <DocumentViewer docId={docId} onClose={() => setDocId(null)} /> : null}

      {editOpen ? (
        <EditApplicationModal
          app={app}
          onClose={() => setEditOpen(false)}
          onSaved={(resubmitted) => {
            setEditOpen(false);
            notify(resubmitted ? 'Corrected application resubmitted.' : 'Draft saved.', 'success');
          }}
        />
      ) : null}

      {withdrawOpen ? (
        <WithdrawModal
          onClose={() => setWithdrawOpen(false)}
          onSubmit={(reason) => {
            try {
              backend.withdraw(app.id, reason);
              notify('Application withdrawn.', 'info');
              setWithdrawOpen(false);
            } catch (err) {
              notify(errorMessage(err), 'error');
            }
          }}
        />
      ) : null}
    </>
  );
}

function ActionModal({
  app,
  options,
  onClose,
  onSubmit,
}: {
  app: Application;
  options: ActionOption[];
  onClose: () => void;
  onSubmit: (option: ActionOption, remarks: { applicant: string; internal: string; visibleToApplicant: boolean }) => void;
}) {
  const [choice, setChoice] = useState<ActionChoice>(options[0]?.value ?? 'remark');
  const [applicant, setApplicant] = useState('');
  const [internal, setInternal] = useState('');
  const [visible, setVisible] = useState(true);
  const option = options.find((o) => o.value === choice) ?? options[0];
  const needsApplicantRemarks = ['reject', 'return', 'clarify'].includes(choice);
  const isFinal = ['finalise', 'approve_forward', 'reject'].includes(choice);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Record a decision"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={choice === 'reject' ? 'danger' : choice === 'finalise' ? 'success' : 'primary'}
            onClick={() => {
              if (isFinal && !window.confirm(confirmText(choice, app))) return;
              onSubmit(option, { applicant, internal, visibleToApplicant: visible });
            }}
            disabled={needsApplicantRemarks && applicant.trim().length < 3}
          >
            Confirm {option?.label.toLowerCase()}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Action" htmlFor="action-choice">
          <Select id="action-choice" value={choice} onChange={(e) => setChoice(e.target.value as ActionChoice)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
        {option ? <Alert tone={choice === 'reject' ? 'danger' : choice === 'approve_forward' ? 'warn' : 'info'}>{option.hint}</Alert> : null}
        <Field
          label="Remarks for the applicant"
          htmlFor="applicant-remarks"
          required={needsApplicantRemarks}
          hint={
            needsApplicantRemarks
              ? 'Required. Shown on the applicant’s timeline without any internal context.'
              : 'Optional. Shown on the applicant’s timeline.'
          }
        >
          <TextArea id="applicant-remarks" value={applicant} onChange={(e) => setApplicant(e.target.value)} maxLength={4000} />
        </Field>
        <Field label="Internal note (officers only)" htmlFor="internal-remarks" hint="Never shown to the applicant. Visible to authorised officers with post history access.">
          <TextArea id="internal-remarks" value={internal} onChange={(e) => setInternal(e.target.value)} maxLength={4000} />
        </Field>
        {choice === 'remark' ? (
          <label className="checkbox">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            <span>Show this remark to the applicant</span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

function confirmText(choice: ActionChoice, app: Application): string {
  switch (choice) {
    case 'reject':
      return `Reject ${app.reference}? This is final and the applicant will be notified.`;
    case 'finalise':
      return `Finalise ${app.reference}? This completes the application.`;
    case 'approve_forward':
      return `Approve and forward ${app.reference}? It will remain pending at the higher post and will NOT be marked approved.`;
    default:
      return 'Confirm this action?';
  }
}

function EditApplicationModal({
  app,
  onClose,
  onSaved,
}: {
  app: Application;
  onClose: () => void;
  onSaved: (resubmitted: boolean) => void;
}) {
  const { data, backend, notify } = useApp();
  const type = data.applicationTypes.find((t) => t.id === app.application_type_id);
  const [values, setValues] = useState<Record<string, unknown>>({ ...app.data });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const docs = data.documents.filter((d) => d.application_id === app.id);
  const [uploading, setUploading] = useState<string | null>(null);

  if (!type) return null;
  const canResubmit = app.status === 'returned';

  function save(submit: boolean) {
    try {
      backend.updateDraft(app.id, values);
      if (submit) backend.submit(app.id);
      onSaved(submit);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors((err.details?.fields as Record<string, string>) ?? {});
        notify(err.message, 'error');
      } else {
        notify(errorMessage(err), 'error');
      }
    }
  }

  async function upload(docKey: string, file: File | undefined) {
    if (!file) return;
    setUploading(docKey);
    try {
      await backend.uploadDocument(app.id, docKey, file);
      notify('Attachment updated.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setUploading(null);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={canResubmit ? 'Correct and resubmit' : 'Edit draft'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => save(false)}>Save draft</Button>
          {canResubmit || app.status === 'draft' ? (
            <Button onClick={() => save(true)}>Resubmit</Button>
          ) : null}
        </>
      }
    >
      <div className="form-grid">
        {type.fields.map((field) => (
          <FormFieldInput
            key={field.key}
            field={field}
            value={values[field.key]}
            error={errors[field.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        ))}
      </div>
      {type.documents.length ? (
        <fieldset>
          <legend>Documents</legend>
          {type.documents.map((doc) => {
            const attached = docs.filter((d) => d.doc_key === doc.key);
            return (
              <div key={doc.key} style={{ marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                    {doc.label} {doc.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                  </span>
                  <label className="btn secondary small" style={{ cursor: 'pointer' }}>
                    <Icon.Upload size={13} /> {uploading === doc.key ? 'Uploading…' : attached.length ? 'Replace' : 'Attach'}
                    <input
                      type="file"
                      className="sr-only"
                      accept={doc.accept.join(',')}
                      onChange={(e) => {
                        void upload(doc.key, e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {attached.map((a) => (
                  <div key={a.id} className="row" style={{ gap: 8, fontSize: '0.8rem', marginTop: 6 }}>
                    <Icon.File size={14} />
                    <span style={{ flex: 1 }}>{a.file_name}</span>
                    <span className="cell-sub">{bytes(a.size)}</span>
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => {
                        try {
                          backend.removeDocument(a.id);
                        } catch (err) {
                          notify(errorMessage(err), 'error');
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <Alert tone="info">
        Existing files stay in the record; replacing a file adds a new version and keeps the earlier one for the
        audit trail.
      </Alert>
    </Modal>
  );
}

function WithdrawModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Withdraw application"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => onSubmit(reason)}>
            Withdraw
          </Button>
        </>
      }
    >
      <Field label="Reason for withdrawal" htmlFor="withdraw-reason" required hint="Recorded in the application history.">
        <TextArea id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ActionBadge({ action }: { action: ActionType }) {
  return <Chip tone="neutral">{humanise(action)}</Chip>;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value}</span>
    </div>
  );
}
