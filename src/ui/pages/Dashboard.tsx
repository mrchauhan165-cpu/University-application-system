import type { ReactNode } from 'react';
import { Icon } from '../components/Icons';
import { Alert, Button, Card, CardHeader, Chip, EmptyState, StatusChip } from '../components/UI';
import { ProgressDots } from '../components/Progress';
import { useApp, useSession } from '../context';
import { ageLabel, ageTone, daysSince, formatDate, formatDateTime, fromNow, humanise, initialLetters } from '../lib/format';
import {
  applicationOrgText,
  applicationSteps,
  currentMentor,
  historyForSession,
  myApplications,
  noticesUnread,
  pendingForSession,
  postName,
  statsFor,
  typeName,
} from '../lib/selectors';
import type { Application } from '../../domain/types';

const HONORIFIC = /^(prof|dr|mr|mrs|ms|miss|sir|madam|shri|smt|er)\.?$/i;

export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const name = parts.find((part) => !HONORIFIC.test(part) && !part.endsWith('.'));
  return name ?? parts[0] ?? 'there';
}

function daysWaiting(app: Application): number {
  return daysSince(app.updated_at ?? app.submitted_at);
}

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
  // Dean level and above approve but never apply, so the "start" affordances
  // disappear for them (the backend refuses anyway — this keeps the UI honest).
  const availableTypes = session.canSubmit
    ? data.applicationTypes.filter((t) => t.active && t.applicant_kinds.includes(profile.kind))
    : [];
  const recentNotices = data.notices
    .filter((n) => n.status === 'published')
    .sort((a, b) => ((a.publish_at ?? '') < (b.publish_at ?? '') ? 1 : -1))
    .slice(0, 4);
  const readIds = new Set(data.noticeReads.map((r) => r.notice_id));
  const mentor = currentMentor(data, profile.section_id);
  const activeAssignments = session.assignments.filter((a) => a.active);

  const returned = mine.filter((a) => a.status === 'returned');
  const drafts = mine.filter((a) => a.status === 'draft');
  const openCount = counts.open.length + returned.length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const oldestPending = [...pending].sort((a, b) => daysWaiting(b) - daysWaiting(a))[0];

  /* The single most useful thing for this person right now. */
  const focus = isOfficer && pending.length
    ? {
        tone: 'info' as const,
        icon: <Icon.Inbox size={18} />,
        title: `${pending.length} application${pending.length === 1 ? '' : 's'} waiting for your decision`,
        body: oldestPending
          ? `Oldest: ${typeName(data, oldestPending.application_type_id)} · ${oldestPending.reference} · ${oldestPending.applicant_name} · waiting ${daysWaiting(oldestPending)} day${daysWaiting(oldestPending) === 1 ? '' : 's'}.`
          : 'Open your inbox to review them.',
        action: { label: 'Open my inbox', to: '/inbox' },
      }
    : returned.length
      ? {
          tone: 'warn' as const,
          icon: <Icon.Alert size={18} />,
          title: `${returned.length} application${returned.length === 1 ? '' : 's'} returned for correction`,
          body: 'An officer asked for changes. Correct it and resubmit so the review can continue.',
          action: { label: 'Open application', to: `/applications/${returned[0].id}` },
        }
      : drafts.length
        ? {
            tone: 'neutral' as const,
            icon: <Icon.File size={18} />,
            title: `You have ${drafts.length} unfinished draft${drafts.length === 1 ? '' : 's'}`,
            body: 'Nothing has been sent to an officer yet. Submit when you are ready.',
            action: { label: 'Continue draft', to: `/applications/${drafts[0].id}` },
          }
        : null;

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="dash-hero">
        <div className="dash-hero-main">
          <div className="dash-hero-eyebrow">{today}</div>
          <h1 className="dash-hero-title">
            {greeting}, {firstName(profile.full_name)}
          </h1>
          <div className="dash-hero-meta">
            <span className="mono">{profile.user_code}</span>
            <span aria-hidden="true">·</span>
            <span>{humanise(profile.kind)}</span>
            {activeAssignments.map((a) => (
              <span key={a.id} className="dash-hero-chip">
                <Icon.Shield size={12} /> {postName(data, a.post_code)}
              </span>
            ))}
            {profile.kind === 'student' && !activeAssignments.length ? (
              <span className="dash-hero-chip">Own records only</span>
            ) : null}
          </div>
        </div>
        <div className="dash-hero-actions">
          <Button variant="secondary" onClick={() => { window.location.hash = '#/notices'; }}>
            <Icon.Book size={16} /> Notices
            {unreadNotices.length ? <span className="dash-count">{unreadNotices.length}</span> : null}
          </Button>
          {availableTypes.length ? (
            <Button onClick={() => { window.location.hash = '#/applications/new'; }}>
              <Icon.Plus size={16} /> New application
            </Button>
          ) : null}
        </div>
      </section>

      {focus ? (
        <section className={`focus-band tone-${focus.tone}`}>
          <span className="focus-icon" aria-hidden="true">{focus.icon}</span>
          <div className="focus-text">
            <div className="focus-title">{focus.title}</div>
            <div className="focus-body">{focus.body}</div>
          </div>
          <Button
            size="small"
            variant={focus.tone === 'warn' ? 'primary' : 'secondary'}
            onClick={() => { window.location.hash = `#${focus.action.to}`; }}
          >
            {focus.action.label} <Icon.Chevron size={13} />
          </Button>
        </section>
      ) : null}

      {profile.kind !== 'student' && activeAssignments.length === 0 ? (
        <div className="dash-block">
          <Alert tone="info" title="No active post assignment.">
            You can still submit your own applications and read notices addressed to you. Officer tools appear
            automatically when the university assigns you a post.
          </Alert>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ KPIs */}
      <div className="kpi-grid">
        <KpiTile
          label="My applications"
          value={mine.length}
          hint={drafts.length ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} not submitted` : 'All submitted'}
          icon={<Icon.File size={16} />}
          to="/applications"
        />
        <KpiTile
          label="In progress"
          value={openCount}
          hint={
            returned.length
              ? `${returned.length} needs your correction`
              : openCount
                ? 'With an officer'
                : 'Nothing pending'
          }
          tone="warn"
          icon={<Icon.Clock size={16} />}
          to="/applications"
        />
        <KpiTile
          label="Completed"
          value={counts.done.length}
          hint={counts.rejected.length ? `${counts.rejected.length} rejected` : 'Approved or finalised'}
          tone="success"
          icon={<Icon.CheckCircle size={16} />}
          to="/applications"
        />
        {isOfficer ? (
          <KpiTile
            label="Awaiting my action"
            value={pending.length}
            hint={session.postNames.join(', ') || 'No active post'}
            tone={pending.length ? 'info' : undefined}
            icon={<Icon.Inbox size={16} />}
            to="/inbox"
          />
        ) : (
          <KpiTile
            label="Unread notices"
            value={unreadNotices.length}
            hint="Published for your scope"
            icon={<Icon.Bell size={16} />}
            to="/notices"
          />
        )}
      </div>

      {/* ---------------------------------------------------------- content */}
      <div className="dash-columns">
        <div className="stack">
          {isOfficer ? (
            <Card>
              <CardHeader
                title="Waiting on you"
                subtitle={pending.length ? `${pending.length} at ${session.postNames.join(' / ') || 'your post'}` : 'Nothing at your post'}
                actions={
                  <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/inbox'; }}>
                    Open inbox
                  </Button>
                }
              />
              {pending.length === 0 ? (
                <EmptyState
                  icon={<Icon.CheckCircle size={22} />}
                  title="Your queue is clear"
                  description="Applications routed to your post appear here. You will also get a notification."
                />
              ) : (
                <div className="action-list">
                  {pending.slice(0, 5).map((app) => {
                    const age = daysWaiting(app);
                    return (
                      <a key={app.id} className="action-row" href={`#/applications/${app.id}`}>
                        <span className={`action-rail ${age >= 3 ? 'is-overdue' : ''}`} aria-hidden="true" />
                        <div className="action-main">
                          <div className="action-title">
                            {typeName(data, app.application_type_id)}
                            {app.confidential ? <span className="mini-flag">Confidential</span> : null}
                          </div>
                          <div className="action-sub">
                            <span className="mono">{app.reference}</span> · {app.applicant_name}
                          </div>
                          <div className="action-sub">{applicationOrgText(data, app)}</div>
                        </div>
                        <div className="action-side">
                          <Chip tone={ageTone(age)}>{ageLabel(age)}</Chip>
                          <span className="action-cta">
                            Review <Icon.Chevron size={13} />
                          </span>
                        </div>
                      </a>
                    );
                  })}
                  {pending.length > 5 ? (
                    <div className="action-more">
                      <a href="#/inbox">+{pending.length - 5} more in your inbox</a>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title={isOfficer ? 'My own applications' : 'Your applications'}
              subtitle="Only records you submitted yourself"
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
              <div className="app-list">
                {mine.slice(0, 5).map((app) => (
                  <a key={app.id} className="app-row" href={`#/applications/${app.id}`}>
                    <div className="app-row-main">
                      <div className="action-title">
                        {typeName(data, app.application_type_id)}
                        {app.confidential ? <span className="mini-flag">Confidential</span> : null}
                      </div>
                      <div className="action-sub">
                        <span className="mono">{app.reference}</span> ·{' '}
                        {app.submitted_at ? formatDate(app.submitted_at) : `saved ${fromNow(app.updated_at)}`}
                      </div>
                    </div>
                    <div className="app-row-side">
                      <ProgressDots steps={applicationSteps(data, app)} />
                      <StatusChip status={app.status} />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {isOfficer ? (
            <Card>
              <CardHeader
                title="Recent decisions at your post"
                subtitle="Includes decisions taken by previous holders of the same post"
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
                  description="Once an application passes through your post it appears here — even after the post changes hands."
                />
              ) : (
                <ul className="feed">
                  {history.slice(0, 4).map((app) => (
                    <li key={app.id} className="feed-item">
                      <span className="avatar sm" aria-hidden="true">{initialLetters(app.applicant_name)}</span>
                      <div className="feed-body">
                        <a className="feed-title" href={`#/applications/${app.id}`}>
                          {typeName(data, app.application_type_id)}{' '}
                          <span className="mono cell-sub">{app.reference}</span>
                        </a>
                        <div className="feed-meta">
                          {app.applicant_name} · {formatDateTime(app.updated_at)}
                        </div>
                        <div className="feed-tags">
                          <StatusChip status={app.status} />
                          {app.current_post ? (
                            <span className="cell-sub">with {postName(data, app.current_post)}</span>
                          ) : null}
                        </div>
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
              <CardHeader
                title="Start something new"
                subtitle="Types open to your group"
                actions={<Chip tone="neutral">{availableTypes.length}</Chip>}
              />
              <div className="quick-list">
                {availableTypes.slice(0, 4).map((type) => (
                  <a key={type.id} className="quick-item" href={`#/applications/new?type=${encodeURIComponent(type.id)}`}>
                    <span className="quick-icon" aria-hidden="true"><Icon.File size={16} /></span>
                    <span className="quick-text">
                      <span className="quick-title">
                        {type.name}
                        {type.confidential ? <span className="mini-flag">Confidential</span> : null}
                      </span>
                      <span className="quick-sub">{type.description}</span>
                    </span>
                    <Icon.Chevron size={15} />
                  </a>
                ))}
              </div>
              <div className="card-foot-link">
                <a href="#/applications/new">See all application types <Icon.Chevron size={13} /></a>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Notices"
              subtitle={unreadNotices.length ? `${unreadNotices.length} unread for your scope` : 'Up to date'}
              actions={
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/notices'; }}>
                  All
                </Button>
              }
            />
            {recentNotices.length === 0 ? (
              <EmptyState
                icon={<Icon.Book size={22} />}
                title="No notices yet"
                description="Notices published for your university, faculty, department, batch or section appear here."
              />
            ) : (
              <div className="notice-list">
                {recentNotices.map((notice) => (
                  <a key={notice.id} className="notice-row" href={`#/notices/${notice.id}`}>
                    <div className="notice-text">
                      <div className="notice-title">
                        {readIds.has(notice.id) ? null : <span className="dot-new" aria-label="Unread" />}
                        {notice.title}
                      </div>
                      <div className="notice-meta">
                        {notice.scope_label} · {formatDate(notice.publish_at)}
                      </div>
                    </div>
                    <Icon.Chevron size={15} />
                  </a>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={profile.kind === 'student' ? 'Academic record' : 'Employment record'} />
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
                    {mentor ? (
                      <>
                        <dt>Mentor</dt>
                        <dd>{mentor}</dd>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <dt>Department</dt>
                    <dd>{data.departments.find((d) => d.id === profile.home_department_id)?.name ?? '—'}</dd>
                    <dt>Designation</dt>
                    <dd>{profile.designation ?? '—'}</dd>
                    <dt>Posts</dt>
                    <dd>
                      {activeAssignments.length
                        ? activeAssignments.map((a) => postName(data, a.post_code)).join(', ')
                        : 'No active post'}
                    </dd>
                  </>
                )}
                <dt>Email</dt>
                <dd>{profile.email}</dd>
                <dt>Last sign-in</dt>
                <dd>{profile.last_login_at ? fromNow(profile.last_login_at) : 'Just now'}</dd>
              </dl>
              <div className="row" style={{ marginTop: 14 }}>
                <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/profile'; }}>
                  <Icon.Users size={14} /> Profile &amp; security
                </Button>
                <Button variant="ghost" size="small" onClick={() => { window.location.hash = '#/help'; }}>
                  <Icon.Help size={14} /> Help
                </Button>
              </div>
            </div>
          </Card>

          {isAdmin ? (
            <Card>
              <CardHeader title="Administration" subtitle="Aggregate counts — no application contents" />
              <div className="card-pad">
                <div className="mini-grid">
                  <MiniStat label="Faculties" value={data.faculties.filter((f) => !f.archived).length} icon={<Icon.Building size={15} />} />
                  <MiniStat label="Departments" value={data.departments.filter((d) => !d.archived).length} icon={<Icon.Layers size={15} />} />
                  <MiniStat label="Users" value={data.profiles.length} icon={<Icon.Users size={15} />} />
                  <MiniStat label="Assignments" value={data.assignments.filter((a) => a.active).length} icon={<Icon.Shield size={15} />} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <Button variant="secondary" size="small" onClick={() => { window.location.hash = '#/admin/structure'; }}>
                    <Icon.Settings size={14} /> Open administration
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

    </>
  );
}

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone,
  to,
}: {
  label: string;
  value: number;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: 'success' | 'warn' | 'danger' | 'info';
  to: string;
}) {
  return (
    <a className={`kpi ${tone ? `is-${tone}` : ''}`} href={`#${to}`}>
      <span className="kpi-icon" aria-hidden="true">{icon}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
      {hint ? <span className="kpi-hint">{hint}</span> : null}
    </a>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="mini-stat">
      <span className="mini-stat-icon" aria-hidden="true">{icon}</span>
      <span className="mini-stat-value">{value}</span>
      <span className="mini-stat-label">{label}</span>
    </div>
  );
}
