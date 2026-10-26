import { Icon } from '../components/Icons';
import { Alert, Button, Card, CardHeader, Chip, EmptyState, PageHeader, StatCard, StatusChip } from '../components/UI';
import { useApp, useSession } from '../context';
import { formatDate, formatDateTime, fromNow, humanise, initialLetters } from '../lib/format';
import {
  applicationOrgText,
  canActOn,
  currentMentor,
  historyForSession,
  myApplications,
  noticesUnread,
  pendingForSession,
  postName,
  statsFor,
  typeName,
} from '../lib/selectors';

export function DashboardPage() {
  const { data } = useApp();
  const session = useSession();
  const profile = session.profile;
  const mine = myApplications(data, session);
  const counts = statsFor(mine);
  const unreadNotices = noticesUnread(data, session);
  const pending = pendingForSession(data, session);
  const history = historyForSession(data, session);
  const isOfficer = session.permissions.includes('application.view');
  const isAdmin = session.permissions.includes('user.manage') || session.permissions.includes('system.admin');
  const availableTypes = data.applicationTypes.filter(
    (t) => t.active && t.applicant_kinds.includes(profile.kind),
  );
  const recentNotices = data.notices
    .filter((n) => n.status === 'published')
    .sort((a, b) => ((a.publish_at ?? '') < (b.publish_at ?? '') ? 1 : -1))
    .slice(0, 4);
  const readIds = new Set(data.noticeReads.map((r) => r.notice_id));
  const mentor = currentMentor(data, profile.section_id);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const activeAssignments = session.assignments.filter((a) => a.active);

  return (
    <>
      <PageHeader
        title={`${greeting}, ${profile.full_name.split(' ')[0]}`}
        subtitle={
          <span>
            {profile.user_code} · {humanise(profile.kind)}
            {activeAssignments.length
              ? ` · ${activeAssignments
                  .map((a) => `${postName(data, a.post_code)}`)
                  .filter((v, i, arr) => arr.indexOf(v) === i)
                  .join(', ')}`
              : ''}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => { window.location.hash = '#/notices'; }}>
              <Icon.Book size={16} /> Notices
              {unreadNotices.length ? <span className="chip warn" style={{ padding: '0 6px' }}>{unreadNotices.length}</span> : null}
            </Button>
            {availableTypes.length ? (
              <Button onClick={() => { window.location.hash = '#/applications/new'; }}>
                <Icon.Plus size={16} /> New application
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <StatCard
          label="My applications"
          value={mine.length}
          hint={`${counts.drafts.length} draft${counts.drafts.length === 1 ? '' : 's'}`}
          icon={<Icon.File size={17} />}
        />
        <StatCard
          label="Pending"
          value={counts.open.length + counts.returned.length}
          hint="Awaiting a decision or correction"
          tone="warn"
          icon={<Icon.Clock size={17} />}
        />
        <StatCard
          label="Completed"
          value={counts.done.length}
          hint="Approved or finalised"
          tone="success"
          icon={<Icon.CheckCircle size={17} />}
        />
        {isOfficer ? (
          <StatCard
            label="Awaiting my action"
            value={pending.length}
            hint={session.postNames.join(', ') || 'No active post'}
            tone={pending.length ? 'info' : undefined}
            icon={<Icon.Inbox size={17} />}
          />
        ) : (
          <StatCard
            label="Unread notices"
            value={unreadNotices.length}
            hint="Published for your scope"
            icon={<Icon.Bell size={17} />}
          />
        )}
      </div>

      {profile.kind !== 'student' && activeAssignments.length === 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" title="No active post assignment.">
            You can still submit your own applications and read notices addressed to you. Officer tools appear
            automatically when the university assigns you a post.
          </Alert>
        </div>
      ) : null}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {isOfficer ? (
            <Card>
              <CardHeader
                title="My pending actions"
                subtitle={`Applications currently at ${session.postNames.join(' / ') || 'your post'}`}
                actions={
                  <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/inbox'; }}>
                    Open inbox
                  </Button>
                }
              />
              {pending.length === 0 ? (
                <EmptyState
                  icon={<Icon.CheckCircle size={22} />}
                  title="Nothing waiting"
                  description="Applications routed to your post will appear here."
                />
              ) : (
                <div className="table-wrap responsive">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Application</th>
                        <th>Applicant</th>
                        <th>Waiting</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pending.slice(0, 6).map((app) => (
                        <tr key={app.id}>
                          <td data-label="Application">
                            <div className="cell-title">{typeName(data, app.application_type_id)}</div>
                            <div className="cell-sub mono">{app.reference}</div>
                          </td>
                          <td data-label="Applicant">
                            <div>{app.applicant_name}</div>
                            <div className="cell-sub">{applicationOrgText(data, app)}</div>
                          </td>
                          <td data-label="Waiting">{fromNow(app.submitted_at)}</td>
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
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="My applications"
              subtitle="Only your own applications are shown here."
              actions={
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/applications'; }}>
                  View all
                </Button>
              }
            />
            {mine.length === 0 ? (
              <EmptyState
                icon={<Icon.File size={22} />}
                title="No applications yet"
                description={
                  availableTypes.length
                    ? 'Start your first application — you can save it as a draft and submit when ready.'
                    : 'No application types are currently open for your group.'
                }
                action={
                  availableTypes.length ? (
                    <Button onClick={() => { window.location.hash = '#/applications/new'; }}>
                      <Icon.Plus size={16} /> Start an application
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-wrap responsive">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Application</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {mine.slice(0, 6).map((app) => (
                      <tr key={app.id}>
                        <td data-label="Application">
                          <div className="cell-title">{typeName(data, app.application_type_id)}</div>
                          <div className="cell-sub mono">{app.reference}</div>
                        </td>
                        <td data-label="Submitted">{formatDate(app.submitted_at)}</td>
                        <td data-label="Status"><StatusChip status={app.status} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="small" variant="secondary" onClick={() => { window.location.hash = `#/applications/${app.id}`; }}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {isOfficer ? (
            <Card>
              <CardHeader
                title="History for my current post"
                subtitle="Includes decisions taken by previous holders of the same post and scope."
                actions={
                  <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/history'; }}>
                    Full history
                  </Button>
                }
              />
              {history.length === 0 ? (
                <EmptyState
                  icon={<Icon.History size={22} />}
                  title="No post history yet"
                  description="Once an application passes through your post, it appears here — even after the person holding the post changes."
                />
              ) : (
                <ul className="timeline" style={{ padding: '16px 18px 4px' }}>
                  {history.slice(0, 4).map((app) => (
                    <li key={app.id} className={app.status === 'rejected' ? 'danger' : undefined}>
                      <div className="t-title">
                        <a href={`#/applications/${app.id}`}>{typeName(data, app.application_type_id)}</a>{' '}
                        <span className="mono cell-sub">{app.reference}</span>
                      </div>
                      <div className="t-meta">
                        {app.applicant_name} · {applicationOrgText(data, app)} · {formatDateTime(app.updated_at)}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <StatusChip status={app.status} />
                        {app.current_post ? (
                          <span className="cell-sub" style={{ marginLeft: 8 }}>
                            Currently with {postName(data, app.current_post)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="stack">
          {availableTypes.length ? (
            <Card>
              <CardHeader title="Start an application" subtitle="Types available to your group" />
              <div className="card-pad stack sm">
                {availableTypes.slice(0, 5).map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className="popover-item"
                    style={{ border: '1px solid var(--line)', borderRadius: 10, alignItems: 'center' }}
                    onClick={() => { window.location.hash = `#/applications/new?type=${type.id}`; }}
                  >
                    <span className="stat-icon" style={{ flex: '0 0 34px' }}><Icon.File size={16} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pi-title">{type.name}</span>
                      <span className="pi-body" style={{ display: 'block' }}>{type.description}</span>
                    </span>
                    {type.confidential ? <Chip tone="gold">Confidential</Chip> : null}
                    <Icon.Chevron size={15} />
                  </button>
                ))}
                <Button variant="ghost" onClick={() => { window.location.hash = '#/applications/new'; }}>
                  See all application types <Icon.Chevron size={14} />
                </Button>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Recent notices"
              subtitle="Only notices addressed to your scope"
              actions={
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/notices'; }}>
                  All notices
                </Button>
              }
            />
            {recentNotices.length === 0 ? (
              <EmptyState icon={<Icon.Book size={22} />} title="No notices yet" description="Notices published for your university, faculty, department, batch or section appear here." />
            ) : (
              <div>
                {recentNotices.map((notice) => (
                  <a
                    key={notice.id}
                    href={`#/notices/${notice.id}`}
                    className="popover-item"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pi-title">
                        {readIds.has(notice.id) ? null : <span className="chip info" style={{ padding: '0 6px', marginRight: 6 }}>New</span>}
                        {notice.title}
                      </div>
                      <div className="pi-body">
                        {notice.scope_label} · {formatDate(notice.publish_at)} · {notice.creator_name}
                      </div>
                    </div>
                    <Icon.Chevron size={15} />
                  </a>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={profile.kind === 'student' ? 'Academic information' : 'Employment information'} />
            <div className="card-pad">
              <dl className="kv">
                {profile.kind === 'student' ? (
                  <>
                    <dt>Department</dt>
                    <dd>{data.departments.find((d) => d.id === profile.department_id)?.name ?? '—'}</dd>
                    <dt>Batch</dt>
                    <dd>{data.batches.find((b) => b.id === profile.batch_id)?.label ?? '—'}</dd>
                    <dt>Section</dt>
                    <dd>{data.sections.find((s) => s.id === profile.section_id)?.name ?? '—'}</dd>
                    <dt>Roll number</dt>
                    <dd>{profile.roll_no ?? '—'}</dd>
                    <dt>Mentor</dt>
                    <dd>{mentor ?? 'Not assigned'}</dd>
                  </>
                ) : (
                  <>
                    <dt>Department</dt>
                    <dd>{data.departments.find((d) => d.id === profile.home_department_id)?.name ?? '—'}</dd>
                    <dt>Designation</dt>
                    <dd>{profile.designation ?? '—'}</dd>
                    <dt>Current posts</dt>
                    <dd>
                      {activeAssignments.length ? (
                        <div className="stack sm">
                          {activeAssignments.map((a) => (
                            <span key={a.id} className="chip info">
                              {postName(data, a.post_code)} · {formatDate(a.starts_at)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        'No active post'
                      )}
                    </dd>
                  </>
                )}
                <dt>Email</dt>
                <dd>{profile.email}</dd>
              </dl>
              <div style={{ marginTop: 14 }}>
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/profile'; }}>
                  <Icon.Users size={14} /> Profile &amp; security
                </Button>
              </div>
            </div>
          </Card>

          {isAdmin ? (
            <Card>
              <CardHeader title="Administration overview" subtitle="Aggregate counts — no application contents" />
              <div className="card-pad">
                <div className="grid cols-2" style={{ gap: 12 }}>
                  <MiniStat label="Users" value={data.profiles.length} icon={<Icon.Users size={15} />} />
                  <MiniStat label="Active assignments" value={data.assignments.filter((a) => a.active).length} icon={<Icon.Shield size={15} />} />
                  <MiniStat label="Batches" value={data.batches.length} icon={<Icon.Layers size={15} />} />
                  <MiniStat label="Published notices" value={data.notices.filter((n) => n.status === 'published').length} icon={<Icon.Book size={15} />} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/admin/structure'; }}>
                    <Icon.Settings size={14} /> Open administration
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Need help?" />
            <div className="card-pad">
              <p style={{ fontSize: '0.86rem', color: 'var(--muted)' }}>
                Contact the university support desk at{' '}
                <a href={`mailto:${data.settings.support_email}`}>{data.settings.support_email}</a>.
              </p>
              <div style={{ marginTop: 10 }}>
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/help'; }}>
                  <Icon.Help size={14} /> Help &amp; support
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {isOfficer && pending.length ? (
        <div style={{ marginTop: 16 }}>
          <Alert tone="info" title="Reminder:">
            actions are only possible while you hold the post and the application is at your stage. Your access is
            re-checked on every request — old links stop working when an assignment ends.
          </Alert>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card>
          <CardHeader title="Your access at a glance" subtitle="Recalculated from your current assignments on every page load." />
          <div className="card-pad">
            <div className="row" style={{ gap: 8 }}>
              {activeAssignments.length === 0 && profile.kind !== 'student' ? (
                <Chip tone="neutral">No post assignments</Chip>
              ) : null}
              {activeAssignments.map((a) => {
                const post = data.posts.find((p) => p.code === a.post_code);
                return (
                  <span key={a.id} className="chip info" title={`${post?.permissions.join(', ') ?? ''}`}>
                    <Icon.Shield size={13} /> {post?.name ?? a.post_code}
                    <span style={{ opacity: 0.75 }}>· {humanise(post?.scope_type ?? '')}</span>
                  </span>
                );
              })}
              {profile.kind === 'student' ? <Chip tone="neutral">Student: own records only</Chip> : null}
              {pending.length && canActOn(data, session, pending[0]) ? (
                <Chip tone="success">You can act on {pending[0].reference}</Chip>
              ) : null}
            </div>
            <p className="cell-sub" style={{ marginTop: 10 }}>
              Signed in {profile.last_login_at ? fromNow(profile.last_login_at) : 'just now'} ·{' '}
              {initialLetters(profile.full_name)} · Session expires after 12 hours of inactivity in this prototype.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '12px 14px', boxShadow: 'none' }}>
      <div className="row" style={{ gap: 8, color: 'var(--muted)' }}>
        <span className="stat-icon" style={{ width: 28, height: 28, flex: '0 0 28px' }}>{icon}</span>
        <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
