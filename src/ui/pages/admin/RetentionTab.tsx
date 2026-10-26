import { useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, StatusChip, TextArea, TextInput } from '../../components/UI';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { bytes, formatDate, formatDateTime, humanise } from '../../lib/format';
import type { Batch, RetentionJob } from '../../../domain/types';

function retentionDates(batch: Batch): { eligible: string | null; final: string | null } {
  if (!batch.graduated_on) return { eligible: null, final: null };
  const base = new Date(batch.graduated_on);
  const eligible = new Date(base);
  eligible.setMonth(eligible.getMonth() + batch.retention_months);
  const final = new Date(eligible);
  final.setMonth(final.getMonth() + batch.final_months);
  return { eligible: eligible.toISOString(), final: final.toISOString() };
}

export function RetentionTab() {
  const { data, backend, notify } = useApp();
  const [stageFor, setStageFor] = useState<{ batch: Batch; stage: RetentionJob['stage'] } | null>(null);
  const [approveFor, setApproveFor] = useState<RetentionJob | null>(null);
  const [executeFor, setExecuteFor] = useState<RetentionJob | null>(null);
  const [declineFor, setDeclineFor] = useState<RetentionJob | null>(null);
  const [holdFor, setHoldFor] = useState<Batch | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const eligible = data.batches.filter((b) =>
    ['graduated', 'archived', 'retention_review', 'deletion_approval'].includes(b.status),
  );
  const activeHolds = data.legalHolds.filter((h) => h.active);

  return (
    <div className="stack">
      <Alert tone="warn" title="Deletion is never automatic.">
        A retention job needs a dry-run report, a second authorised officer’s approval, a legal-hold check and a typed
        confirmation. Protected records (open applications and legal/permanent categories) are always preserved.
      </Alert>

      <section>
        <h3 style={{ marginBottom: 10 }}>Batches in the retention process</h3>
        {eligible.length === 0 ? (
          <p className="cell-sub">No batch has been graduated or archived yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Batch</th><th>Status</th><th>Graduated</th><th>Initial cleanup from</th><th>Final deletion from</th><th>Legal hold</th><th /></tr>
              </thead>
              <tbody>
                {eligible.map((batch) => {
                  const dates = retentionDates(batch);
                  const hold = activeHolds.find((h) => h.batch_id === batch.id);
                  return (
                    <tr key={batch.id}>
                      <td className="cell-title">{batch.label}</td>
                      <td><StatusChip status={batch.status} label={humanise(batch.status)} /></td>
                      <td>{formatDate(batch.graduated_on)}</td>
                      <td>{formatDate(dates.eligible)}</td>
                      <td>{formatDate(dates.final)}</td>
                      <td>{hold ? <Chip tone="danger">On hold</Chip> : <Chip tone="success">None</Chip>}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                          <Button size="small" variant="secondary" onClick={() => setStageFor({ batch, stage: 'initial_cleanup' })}>
                            Initial cleanup
                          </Button>
                          <Button size="small" variant="secondary" onClick={() => setStageFor({ batch, stage: 'final_deletion' })}>
                            Final deletion
                          </Button>
                          {hold ? (
                            <Button
                              size="small"
                              variant="ghost"
                              onClick={() => {
                                try {
                                  backend.releaseLegalHold(hold.id);
                                  notify('Legal hold released.', 'info');
                                } catch (err) {
                                  notify(errorMessage(err), 'error');
                                }
                              }}
                            >
                              Release hold
                            </Button>
                          ) : (
                            <Button size="small" variant="ghost" onClick={() => { setHoldFor(batch); setNotes(''); }}>
                              Add hold
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 10 }}>Retention jobs</h3>
        {data.retentionJobs.length === 0 ? (
          <p className="cell-sub">No jobs proposed yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Batch</th><th>Stage</th><th>Status</th><th>Dry run</th><th>Requested by</th><th>Approved by</th><th /></tr>
              </thead>
              <tbody>
                {data.retentionJobs.map((job) => {
                  const batch = data.batches.find((b) => b.id === job.batch_id);
                  return (
                    <tr key={job.id}>
                      <td className="cell-title">{batch?.label ?? '—'}</td>
                      <td>{humanise(job.stage)}</td>
                      <td><StatusChip status={job.status} label={humanise(job.status)} /></td>
                      <td className="cell-sub">
                        {job.dry_run ? (
                          <>
                            {job.dry_run.applications} applications · {job.dry_run.documents} files ({bytes(job.dry_run.bytes)}) ·{' '}
                            {job.dry_run.notices} notices
                            <div>{job.dry_run.protected} protected record(s) preserved</div>
                          </>
                        ) : 'Not generated'}
                      </td>
                      <td className="cell-sub">{data.profiles.find((p) => p.id === job.requested_by)?.full_name ?? '—'}</td>
                      <td className="cell-sub">{data.profiles.find((p) => p.id === job.approved_by)?.full_name ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row tight" style={{ justifyContent: 'flex-end' }}>
                          {job.status === 'awaiting_approval' ? (
                            <>
                              <Button size="small" onClick={() => { setApproveFor(job); setNotes(''); }}>Approve</Button>
                              <Button size="small" variant="ghost" onClick={() => { setDeclineFor(job); setNotes(''); }}>Decline</Button>
                            </>
                          ) : null}
                          {job.status === 'approved' ? (
                            <Button size="small" variant="danger" onClick={() => { setExecuteFor(job); setConfirmation(''); }}>
                              Execute
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 10 }}>Legal holds</h3>
        {data.legalHolds.length === 0 ? (
          <p className="cell-sub">No legal holds recorded.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Batch</th><th>Reason</th><th>State</th><th>Created</th><th>Released</th></tr></thead>
              <tbody>
                {data.legalHolds.map((hold) => (
                  <tr key={hold.id}>
                    <td>{data.batches.find((b) => b.id === hold.batch_id)?.label ?? '—'}</td>
                    <td>{hold.reason}</td>
                    <td><Chip tone={hold.active ? 'danger' : 'neutral'}>{hold.active ? 'Active' : 'Released'}</Chip></td>
                    <td className="cell-sub">{formatDate(hold.created_at)}</td>
                    <td className="cell-sub">{hold.released_at ? formatDate(hold.released_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 10 }}>Deletion audit</h3>
        {data.deletionAudits.length === 0 ? (
          <p className="cell-sub">Nothing has been deleted in this data set.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Batch</th><th>Stage</th><th>Outcome</th><th>Counts</th><th>Approved by</th><th>When</th></tr></thead>
              <tbody>
                {data.deletionAudits.map((audit) => (
                  <tr key={audit.id}>
                    <td className="cell-title">{audit.batch_label}</td>
                    <td>{humanise(audit.stage)}</td>
                    <td><Chip tone={audit.outcome === 'executed' ? 'success' : 'neutral'}>{humanise(audit.outcome)}</Chip></td>
                    <td className="cell-sub">
                      {Object.entries(audit.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </td>
                    <td>{audit.approved_by_name}</td>
                    <td className="cell-sub">{formatDateTime(audit.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {stageFor ? (
        <Modal
          open
          onClose={() => setStageFor(null)}
          title={`Propose ${stageFor.stage === 'final_deletion' ? 'final deletion' : 'initial cleanup'} — ${stageFor.batch.label}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setStageFor(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  try {
                    const job = backend.createRetentionJob(stageFor.batch.id, stageFor.stage);
                    notify(
                      `Job proposed. Dry run: ${job.dry_run?.applications ?? 0} applications, ${job.dry_run?.documents ?? 0} files, ${job.dry_run?.protected ?? 0} protected. A second officer must approve it.`,
                      'success',
                    );
                    setStageFor(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Generate dry run &amp; propose
              </Button>
            </>
          }
        >
          <Alert tone="info" title="Nothing is deleted at this step.">
            A dry-run report is generated and the job waits for a different authorised officer to approve it.
          </Alert>
          <p style={{ marginTop: 12, fontSize: '0.86rem', color: 'var(--muted)' }}>
            {stageFor.stage === 'initial_cleanup'
              ? 'Initial cleanup removes attachments for eligible records while keeping application rows and decisions for the additional retention period.'
              : 'Final deletion removes eligible application rows, their documents and batch-scoped notices. Records on legal hold or with legal/permanent categories, and any still-open application, are preserved.'}
          </p>
        </Modal>
      ) : null}

      {approveFor ? (
        <Modal
          open
          onClose={() => setApproveFor(null)}
          title="Approve retention job"
          footer={
            <>
              <Button variant="secondary" onClick={() => setApproveFor(null)}>Cancel</Button>
              <Button
                disabled={notes.trim().length < 5}
                onClick={() => {
                  try {
                    backend.approveRetentionJob(approveFor.id, notes);
                    notify('Retention job approved. Execution still requires a typed confirmation.', 'success');
                    setApproveFor(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Approve job
              </Button>
            </>
          }
        >
          <Alert tone="warn" title="Separation of duties.">
            The proposing officer cannot approve their own job. Legal holds block approval.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field label="Approval justification (recorded)" htmlFor="approval-notes" required>
              <TextArea id="approval-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {declineFor ? (
        <Modal
          open
          onClose={() => setDeclineFor(null)}
          title="Decline retention job"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeclineFor(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={notes.trim().length < 5}
                onClick={() => {
                  try {
                    backend.declineRetentionJob(declineFor.id, notes);
                    notify('Job declined and the batch returned to archived.', 'info');
                    setDeclineFor(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Decline
              </Button>
            </>
          }
        >
          <Field label="Reason" htmlFor="decline-notes" required>
            <TextArea id="decline-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Modal>
      ) : null}

      {executeFor ? (
        <Modal
          open
          onClose={() => setExecuteFor(null)}
          title="Execute retention job"
          footer={
            <>
              <Button variant="secondary" onClick={() => setExecuteFor(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={confirmation.trim().toLowerCase() !== (data.batches.find((b) => b.id === executeFor.batch_id)?.label ?? '').toLowerCase()}
                onClick={() => {
                  try {
                    backend.executeRetentionJob(executeFor.id, confirmation);
                    notify('Retention job executed. A deletion audit record was created.', 'success');
                    setExecuteFor(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Delete permanently
              </Button>
            </>
          }
        >
          <Alert tone="danger" title="This cannot be undone.">
            Eligible records and files will be removed from this data set. Backups are outside the scope of this
            prototype. Protected records are preserved and recorded in the audit entry.
          </Alert>
          <div style={{ marginTop: 12 }}>
            <Field
              label="Type the batch label to confirm"
              htmlFor="execute-confirm"
              required
              hint={`Type “${data.batches.find((b) => b.id === executeFor.batch_id)?.label ?? ''}” exactly.`}
            >
              <TextInput id="execute-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {holdFor ? (
        <Modal
          open
          onClose={() => setHoldFor(null)}
          title={`Add legal hold — ${holdFor.label}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setHoldFor(null)}>Cancel</Button>
              <Button
                disabled={notes.trim().length < 5}
                onClick={() => {
                  try {
                    backend.addLegalHold(holdFor.id, notes);
                    notify('Legal hold recorded. Retention jobs for this batch are blocked.', 'info');
                    setHoldFor(null);
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Add hold
              </Button>
            </>
          }
        >
          <Field label="Reason for the hold" htmlFor="hold-reason" required>
            <TextArea id="hold-reason" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ongoing legal dispute / regulatory audit" />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}

export function RetentionStageSelect({
  value,
  onChange,
}: {
  value: RetentionJob['stage'];
  onChange: (stage: RetentionJob['stage']) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as RetentionJob['stage'])}>
      <option value="initial_cleanup">Initial cleanup</option>
      <option value="final_deletion">Final deletion</option>
    </Select>
  );
}
