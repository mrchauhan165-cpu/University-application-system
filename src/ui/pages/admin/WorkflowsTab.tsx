import { useMemo, useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, TextArea, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { formatDate, humanise } from '../../lib/format';
import { postName } from '../../lib/selectors';
import type { BeyondFinalStage, WorkflowStage } from '../../../domain/types';

export function WorkflowsTab() {
  const { data, backend, notify } = useApp();
  const [typeId, setTypeId] = useState(data.applicationTypes[0]?.id ?? '');
  const type = data.applicationTypes.find((t) => t.id === typeId);
  const versions = useMemo(
    () => data.workflows.filter((w) => w.application_type_id === typeId).sort((a, b) => b.version - a.version),
    [data.workflows, typeId],
  );
  const active = versions.find((v) => v.status === 'active');
  const [editing, setEditing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migrated, setMigrated] = useState<number | null>(null);

  const inProgress = backend.inProgressCountForType(typeId);

  return (
    <div className="stack">
      <Alert tone="info" title="Versioned workflows.">
        Saving a route creates a new version. Applications already in progress keep the version they were submitted
        under; moving them is a separate, audited action.
      </Alert>

      <Field label="Application type" htmlFor="wf-type">
        <Select id="wf-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); setMigrated(null); }}>
          {data.applicationTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>

      <div className="row">
        <h3 style={{ flex: 1 }}>Active route</h3>
        <Button size="small" onClick={() => setEditing(true)} disabled={!type}>
          <Icon.Workflow size={14} /> {active ? 'Edit route (new version)' : 'Create route'}
        </Button>
      </div>

      {active ? (
        <div className="card" style={{ padding: 16, boxShadow: 'none' }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Chip tone="success">Version {active.version} · active</Chip>
            <span className="cell-sub">Created {formatDate(active.created_at)}</span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="stack sm">
            {active.stages.map((stage, index) => (
              <li key={stage.key} className="row" style={{ gap: 10 }}>
                <span className="avatar sm" aria-hidden="true">{index + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{stage.label}</div>
                  <div className="cell-sub">{postName(data, stage.post_code)}{stage.optional ? ' · optional' : ''}</div>
                </div>
              </li>
            ))}
            {active.beyond_final ? (
              <li className="row" style={{ gap: 10 }}>
                <span className="avatar sm" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }} aria-hidden="true"><Icon.Shield size={14} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{active.beyond_final.label} (beyond the final authority)</div>
                  <div className="cell-sub">
                    {postName(data, active.beyond_final.post_code)} · actions: {active.beyond_final.actions.join(', ')}
                  </div>
                </div>
              </li>
            ) : null}
          </ol>
          {active.beyond_final ? (
            <div style={{ marginTop: 12 }}>
              <Alert tone="warn">
                At the last normal stage, “Approve and forward” is the only approval action. The application stays pending
                until the higher post finalises it.
              </Alert>
            </div>
          ) : null}
        </div>
      ) : (
        <Alert tone="warn" title="No active route.">
          Applications of this type cannot be submitted until a route is configured.
        </Alert>
      )}

      <div className="row">
        <h3 style={{ flex: 1 }}>In-progress applications</h3>
        <Chip tone={inProgress ? 'warn' : 'neutral'}>{inProgress} in progress</Chip>
        <Button size="small" variant="secondary" onClick={() => { setMigrating(true); setMigrateError(null); }} disabled={!active || !inProgress}>
          Move to current route
        </Button>
      </div>
      <p className="cell-sub">
        Moving applications is optional and explicit. Each move is audited and both the applicant and the receiving post
        are notified. The workflow administrator never sees application contents.
      </p>

      <section>
        <h3 style={{ marginBottom: 10 }}>Version history</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Version</th><th>Stages</th><th>Beyond final</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="cell-title">v{v.version}</td>
                  <td className="cell-sub">{v.stages.map((s) => postName(data, s.post_code)).join(' → ')}</td>
                  <td className="cell-sub">{v.beyond_final ? postName(data, v.beyond_final.post_code) : '—'}</td>
                  <td><Chip tone={v.status === 'active' ? 'success' : 'neutral'}>{v.status}</Chip></td>
                  <td className="cell-sub">{formatDate(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && active ? (
        <WorkflowEditor
          typeId={typeId}
          current={active}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            notify('New workflow version saved. Existing applications keep their version.', 'success');
          }}
          onError={(m) => notify(m, 'error')}
        />
      ) : null}

      {editing && !active ? (
        <WorkflowEditor
          typeId={typeId}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            notify('Workflow created.', 'success');
          }}
          onError={(m) => notify(m, 'error')}
        />
      ) : null}

      {migrating ? (
        <Modal
          open
          onClose={() => setMigrating(false)}
          title="Move in-progress applications"
          footer={
            <>
              <Button variant="secondary" onClick={() => setMigrating(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  try {
                    const count = backend.migrateApplicationsOfType(typeId, active!.id);
                    setMigrated(count);
                    setMigrating(false);
                    notify(`${count} application(s) moved to version ${active!.version}.`, 'success');
                  } catch (err) {
                    setMigrateError(errorMessage(err));
                  }
                }}
              >
                Move {inProgress} application(s)
              </Button>
            </>
          }
        >
          <Alert tone="warn" title="This changes live applications.">
            They will restart at the first stage of version {active?.version} that is not held by the applicant. Each move
            is recorded in the audit log and both the applicant and the receiving post are notified. Application contents
            are never exposed to you.
          </Alert>
          {migrateError ? <div style={{ marginTop: 12 }}><Alert tone="danger">{migrateError}</Alert></div> : null}
        </Modal>
      ) : null}

      {migrated !== null ? (
        <Alert tone="success" title="Migration complete.">{migrated} application(s) were moved.</Alert>
      ) : null}
    </div>
  );
}

function WorkflowEditor({
  typeId,
  current,
  onClose,
  onSaved,
  onError,
}: {
  typeId: string;
  current?: import('../../../domain/types').WorkflowVersion;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { data, backend } = useApp();
  const posts = data.posts.filter((p) => p.active);
  const [stages, setStages] = useState<WorkflowStage[]>(
    current?.stages.map((s) => ({ ...s })) ?? [{ key: 'stage_1', post_code: posts[0]?.code ?? '', label: posts[0]?.name ?? '', optional: false }],
  );
  const [beyondEnabled, setBeyondEnabled] = useState(Boolean(current?.beyond_final));
  const [beyondPost, setBeyondPost] = useState(current?.beyond_final?.post_code ?? '');
  const [beyondLabel, setBeyondLabel] = useState(current?.beyond_final?.label ?? 'Post above the final authority');
  const [beyondActions, setBeyondActions] = useState<BeyondFinalStage['actions']>(current?.beyond_final?.actions ?? ['finalise', 'reject', 'return']);
  const [notes, setNotes] = useState(current?.notes ?? '');

  function patch(index: number, patchValue: Partial<WorkflowStage>) {
    setStages((list) => list.map((s, i) => (i === index ? { ...s, ...patchValue } : s)));
  }

  function move(index: number, direction: -1 | 1) {
    setStages((list) => {
      const next = [...list];
      const target = index + direction;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={current ? `New workflow version (currently v${current.version})` : 'Create workflow'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                backend.saveWorkflow({
                  application_type_id: typeId,
                  stages,
                  beyond_final: beyondEnabled && beyondPost
                    ? { post_code: beyondPost, label: beyondLabel, actions: beyondActions }
                    : null,
                  notes,
                });
                onSaved();
              } catch (err) {
                onError(errorMessage(err));
              }
            }}
          >
            Save new version
          </Button>
        </>
      }
    >
      <fieldset>
        <legend>Approval stages (in order)</legend>
        {stages.map((stage, index) => (
          <div key={`${stage.key}-${index}`} className="card" style={{ padding: 12, marginBottom: 8, boxShadow: 'none' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 30, textAlign: 'center', paddingBottom: 22 }}>{index + 1}</div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Post" htmlFor={`stage-post-${index}`}>
                  <Select
                    id={`stage-post-${index}`}
                    value={stage.post_code}
                    onChange={(e) => {
                      const post = posts.find((p) => p.code === e.target.value);
                      patch(index, { post_code: e.target.value, label: post?.name ?? stage.label });
                    }}
                  >
                    {posts.map((p) => (
                      <option key={p.code} value={p.code}>{p.name} ({p.scope_type})</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="Stage label" htmlFor={`stage-label-${index}`}>
                  <TextInput id={`stage-label-${index}`} value={stage.label} onChange={(e) => patch(index, { label: e.target.value })} />
                </Field>
              </div>
              <div style={{ width: 120 }}>
                <Field label="Optional" htmlFor={`stage-opt-${index}`}>
                  <Select
                    id={`stage-opt-${index}`}
                    value={stage.optional ? 'yes' : 'no'}
                    onChange={(e) => patch(index, { optional: e.target.value === 'yes' })}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                </Field>
              </div>
              <div className="row tight" style={{ paddingBottom: 10 }}>
                <Button size="small" variant="ghost" onClick={() => move(index, -1)} aria-label="Move stage up"><Icon.Undo size={13} /></Button>
                <Button size="small" variant="ghost" onClick={() => move(index, 1)} aria-label="Move stage down"><Icon.Undo size={13} style={{ transform: 'scaleX(-1)' }} /></Button>
                <Button size="small" variant="ghost" onClick={() => setStages((list) => list.filter((_, i) => i !== index))} aria-label="Remove stage"><Icon.Trash size={13} /></Button>
              </div>
            </div>
          </div>
        ))}
        <Button
          size="small"
          variant="secondary"
          onClick={() =>
            setStages((list) => [
              ...list,
              { key: `stage_${list.length + 1}`, post_code: posts[0]?.code ?? '', label: posts[0]?.name ?? '', optional: false },
            ])
          }
        >
          <Icon.Plus size={13} /> Add stage
        </Button>
        <p className="cell-sub" style={{ marginTop: 8 }}>
          Applicants never approve their own application: a stage held by the applicant is skipped automatically. Optional
          stages are skipped when no officer holds the post.
        </p>
      </fieldset>

      <fieldset>
        <legend>Post beyond the final authority</legend>
        <label className="checkbox" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={beyondEnabled} onChange={(e) => setBeyondEnabled(e.target.checked)} />
          <span>Require a higher post after the last stage (for example the Chancellor)</span>
        </label>
        {beyondEnabled ? (
          <>
            <div className="form-grid">
              <Field label="Post" htmlFor="beyond-post">
                <Select id="beyond-post" value={beyondPost} onChange={(e) => setBeyondPost(e.target.value)}>
                  <option value="">Select post…</option>
                  {posts.filter((p) => !stages.some((s) => s.post_code === p.code)).map((p) => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Label shown in the route" htmlFor="beyond-label">
                <TextInput id="beyond-label" value={beyondLabel} onChange={(e) => setBeyondLabel(e.target.value)} />
              </Field>
            </div>
            <div className="row">
              {(['finalise', 'reject', 'return'] as const).map((action) => (
                <label key={action} className="checkbox">
                  <input
                    type="checkbox"
                    checked={beyondActions.includes(action)}
                    onChange={() =>
                      setBeyondActions((list) =>
                        list.includes(action) ? list.filter((a) => a !== action) : [...list, action],
                      )
                    }
                  />
                  <span>{humanise(action)}</span>
                </label>
              ))}
            </div>
            <p className="cell-sub" style={{ marginTop: 8 }}>
              The final stage must use “Approve and forward”; the application remains non-final until this post completes
              the workflow.
            </p>
          </>
        ) : null}
      </fieldset>

      <Field label="Change note (recorded in the audit log)" htmlFor="wf-notes">
        <TextArea id="wf-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
