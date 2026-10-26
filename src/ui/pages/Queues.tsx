import { useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  PageHeader,
  PermissionDenied,
  Select,
  StatusChip,
  TextInput,
} from '../components/UI';
import { useApp, useSession } from '../context';
import { formatDateTime, fromNow } from '../lib/format';
import {
  applicationOrgText,
  historyForSession,
  pendingForSession,
  postName,
  typeName,
} from '../lib/selectors';

export function InboxPage() {
  const { data } = useApp();
  const session = useSession();
  const [postFilter, setPostFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');

  if (!session.permissions.includes('application.view')) {
    return (
      <>
        <PageHeader title="My pending actions" breadcrumbs={[{ label: 'Dashboard', to: '/' }]} />
        <PermissionDenied what="officer queues" />
      </>
    );
  }

  const pending = pendingForSession(data, session);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pending.filter((app) => {
      if (postFilter && app.current_post !== postFilter) return false;
      if (typeFilter && app.application_type_id !== typeFilter) return false;
      if (q) {
        const haystack = `${app.reference} ${app.applicant_name} ${app.applicant_code} ${typeName(data, app.application_type_id)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [pending, postFilter, typeFilter, query, data]);

  return (
    <>
      <PageHeader
        title="My pending actions"
        subtitle={`Applications waiting at your current post${session.postNames.length ? `: ${session.postNames.join(', ')}` : ''}.`}
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Pending actions' }]}
      />

      <div style={{ marginBottom: 16 }}>
        <Alert tone="info" title="Only your current post is used.">
          The queue is derived from your live assignment, so it empties automatically when an assignment ends. Opening a
          record re-checks your post and organisational scope.
        </Alert>
      </div>

      <Card>
        <CardHeader
          title={`${rows.length} waiting`}
          subtitle={rows.length ? 'Oldest first' : 'Nothing requires your decision right now'}
          actions={<Chip tone="info">{session.postNames.join(' · ') || 'No post'}</Chip>}
        />
        <div className="card-pad">
          <div className="filters" style={{ marginBottom: 14 }}>
            <Field label="Search" htmlFor="inbox-search" className="grow">
              <TextInput id="inbox-search" type="search" placeholder="Reference, applicant or type" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <Field label="Post" htmlFor="inbox-post">
              <Select id="inbox-post" value={postFilter} onChange={(e) => setPostFilter(e.target.value)}>
                <option value="">All my posts</option>
                {session.postCodes.map((code) => (
                  <option key={code} value={code}>{postName(data, code)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Type" htmlFor="inbox-type">
              <Select id="inbox-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {data.applicationTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.CheckCircle size={22} />}
              title={pending.length ? 'No applications match these filters' : 'Your queue is clear'}
              description={
                pending.length
                  ? 'Adjust the filters to see other pending items.'
                  : 'When an application reaches your post it will appear here and you will receive a notification.'
              }
            />
          ) : (
            <div className="table-wrap responsive">
              <table className="data">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Applicant</th>
                    <th>Post</th>
                    <th>Waiting</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((app) => (
                    <tr key={app.id}>
                      <td data-label="Application">
                        <div className="cell-title">{typeName(data, app.application_type_id)}</div>
                        <div className="cell-sub mono">{app.reference}</div>
                        {app.confidential ? <Chip tone="gold">Confidential</Chip> : null}
                      </td>
                      <td data-label="Applicant">
                        <div>{app.applicant_name}</div>
                        <div className="cell-sub">{applicationOrgText(data, app)}</div>
                      </td>
                      <td data-label="Post">{postName(data, app.current_post)}</td>
                      <td data-label="Waiting">{fromNow(app.submitted_at)}</td>
                      <td data-label="Status"><StatusChip status={app.status} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <Button size="small" onClick={() => { window.location.hash = `#/applications/${app.id}`; }}>
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

export function PostHistoryPage() {
  const { data } = useApp();
  const session = useSession();
  const [postFilter, setPostFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

  if (!session.permissions.includes('application.view')) {
    return (
      <>
        <PageHeader title="Post history" breadcrumbs={[{ label: 'Dashboard', to: '/' }]} />
        <PermissionDenied what="post application history" />
      </>
    );
  }

  const history = historyForSession(data, session);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((app) => {
      if (postFilter && !app.post_codes_seen.includes(postFilter)) return false;
      if (statusFilter && app.status !== statusFilter) return false;
      if (q) {
        const haystack = `${app.reference} ${app.applicant_name} ${typeName(data, app.application_type_id)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [history, postFilter, statusFilter, query, data]);

  const actionCount = data.actions.filter((a) => a.post_code && session.postCodes.includes(a.post_code)).length;

  return (
    <>
      <PageHeader
        title="History for my current post"
        subtitle="Applications that reached your post and scope — including decisions taken by previous holders of the same post."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Post history' }]}
      />

      <div style={{ marginBottom: 16 }}>
        <Alert tone="info" title="Post-based history, current holder only.">
          History belongs to the post and organisational scope, not to a person. When an assignment ends the former
          holder loses this view immediately; the identity of every past decision is preserved for the current holder.
        </Alert>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card stat-card">
          <span className="stat-label">Applications in post history</span>
          <span className="stat-value">{history.length}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Recorded post actions</span>
          <span className="stat-value">{actionCount}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Posts you currently hold</span>
          <span className="stat-value">{session.postCodes.length}</span>
          <span className="stat-hint">{session.postNames.join(' · ') || 'None'}</span>
        </div>
      </div>

      <Card>
        <CardHeader title={`${rows.length} record${rows.length === 1 ? '' : 's'}`} />
        <div className="card-pad">
          <div className="filters" style={{ marginBottom: 14 }}>
            <Field label="Search" htmlFor="history-search" className="grow">
              <TextInput id="history-search" type="search" placeholder="Reference, applicant or type" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <Field label="Post" htmlFor="history-post">
              <Select id="history-post" value={postFilter} onChange={(e) => setPostFilter(e.target.value)}>
                <option value="">All my posts</option>
                {session.postCodes.map((code) => (
                  <option key={code} value={code}>{postName(data, code)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="history-status">
              <Select id="history-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under review</option>
                <option value="resubmitted">Resubmitted</option>
                <option value="further_pending">Further approval pending</option>
                <option value="returned">Returned for correction</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
              </Select>
            </Field>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.History size={22} />}
              title="No records in your post history"
              description="Applications appear here once they reach a post you currently hold."
            />
          ) : (
            <div className="table-wrap responsive">
              <table className="data">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Applicant</th>
                    <th>Post(s) involved</th>
                    <th>Last action</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((app) => {
                    const appActions = data.actions
                      .filter((a) => a.application_id === app.id)
                      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
                    const last = appActions[0];
                    return (
                      <tr key={app.id}>
                        <td data-label="Application">
                          <div className="cell-title">{typeName(data, app.application_type_id)}</div>
                          <div className="cell-sub mono">{app.reference}</div>
                        </td>
                        <td data-label="Applicant">
                          <div>{app.applicant_name}</div>
                          <div className="cell-sub">{applicationOrgText(data, app)}</div>
                        </td>
                        <td data-label="Posts">
                          <div className="row tight">
                            {app.post_codes_seen.slice(0, 3).map((code) => (
                              <Chip key={code} tone={session.postCodes.includes(code) ? 'info' : 'neutral'}>
                                {postName(data, code)}
                              </Chip>
                            ))}
                          </div>
                        </td>
                        <td data-label="Last action">
                          {last ? (
                            <>
                              <div style={{ fontSize: '0.82rem' }}>{last.actor_name}</div>
                              <div className="cell-sub">{formatDateTime(last.created_at)}</div>
                            </>
                          ) : '—'}
                        </td>
                        <td data-label="Status"><StatusChip status={app.status} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="small" variant="secondary" onClick={() => { window.location.hash = `#/applications/${app.id}`; }}>
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
