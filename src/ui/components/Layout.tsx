import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Permission } from '../../domain/types';
import { Icon } from './Icons';
import { useApp, navigate } from '../context';
import { Alert } from './UI';
import { fromNow } from '../lib/format';
import { initialLetters } from '../lib/format';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  badge?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, data, route, backend, notify } = useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const bellRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setBellOpen(false);
    setProfileOpen(false);
  }, [route.path]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!session) return <>{children}</>;

  const permissions = session.permissions;
  const can = (p: Permission) => permissions.includes(p);

  const unread = data.notifications.filter((n) => !n.read_at);
  const pendingActions = data.applications.filter(
    (a) =>
      a.current_post &&
      session.postCodes.includes(a.current_post) &&
      ['submitted', 'under_review', 'resubmitted', 'further_pending'].includes(a.status),
  ).length;
  const unreadNotices = data.notices.filter(
    (n) => n.status === 'published' && !data.noticeReads.some((r) => r.notice_id === n.id),
  ).length;

  // Only offer the entry when there is something this person could actually raise.
  const canRaiseApplication =
    session.canSubmit && data.applicationTypes.some((t) => t.active && t.applicant_kinds.includes(session.profile.kind));
  const mainNav: NavItem[] = [
    { label: 'Dashboard', to: '/', icon: <Icon.Home size={18} /> },
    { label: 'My Applications', to: '/applications', icon: <Icon.File size={18} /> },
    // Dean level and above only approve, so they never get a "new application" entry.
    ...(canRaiseApplication
      ? [{ label: 'New Application', to: '/applications/new', icon: <Icon.Plus size={18} /> }]
      : []),
    { label: 'Notices', to: '/notices', icon: <Icon.Book size={18} />, badge: unreadNotices },
  ];

  const officerNav: NavItem[] = can('application.view')
    ? [
        { label: 'My Pending Actions', to: '/inbox', icon: <Icon.Inbox size={18} />, badge: pendingActions },
        { label: 'Post History', to: '/history', icon: <Icon.History size={18} /> },
      ]
    : [];

  const insightsNav: NavItem[] = can('statistics.view')
    ? [{ label: 'Statistics', to: '/statistics', icon: <Icon.Chart size={18} /> }]
    : [];

  const adminNav: NavItem[] =
    can('user.manage') || can('workflow.configure') || can('system.admin') || can('retention.manage') || can('audit.view')
      ? [{ label: 'Administration', to: '/admin/structure', icon: <Icon.Settings size={18} /> }]
      : [];

  const accountNav: NavItem[] = [
    { label: 'My Profile', to: '/profile', icon: <Icon.Users size={18} /> },
    { label: 'Help & Support', to: '/help', icon: <Icon.Help size={18} /> },
  ];

  const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to.split('?')[0]));

  const renderGroup = (title: string, items: NavItem[]) =>
    items.length ? (
      <div className="nav-group">
        <div className="nav-group-title">{title}</div>
        {items.map((item) => (
          <a
            key={item.to}
            href={`#${item.to}`}
            className={`nav-item ${isActive(item.to) ? 'active' : ''}`}
            aria-current={isActive(item.to) ? 'page' : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge > 9 ? '9+' : item.badge}</span> : null}
          </a>
        ))}
      </div>
    ) : null;

  const roleLabel =
    session.postNames.length > 0
      ? session.postNames.join(' · ')
      : session.profile.kind === 'student'
        ? 'Student'
        : 'Staff (no active post)';

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <div
        className={`mobile-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">{data.settings.university_short.slice(0, 3)}</div>
          <div className="brand-text">
            <div className="brand-name">{data.settings.university_name}</div>
            <div className="brand-sub">Application portal</div>
          </div>
        </div>
        <nav className="nav">
          {renderGroup('Workspace', mainNav)}
          {renderGroup('Approvals', officerNav)}
          {renderGroup('Insights', insightsNav)}
          {renderGroup('Administration', adminNav)}
          {renderGroup('Account', accountNav)}
        </nav>
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">{initialLetters(session.profile.full_name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-user-name">{session.profile.full_name}</div>
            <div className="sidebar-user-role">{roleLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              backend.signOut();
              notify('Signed out.', 'info');
            }}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon.Logout size={15} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <Icon.Menu size={20} />
          </button>
          <form
            className="topbar-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`);
            }}
          >
            <Icon.Search />
            <label htmlFor="global-search" className="sr-only">Search applications and notices</label>
            <input
              id="global-search"
              type="search"
              placeholder="Search applications, reference numbers, notices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="topbar-actions">
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                className="icon-button"
                aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`}
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((v) => !v)}
              >
                <Icon.Bell size={19} />
                {unread.length ? <span className="badge-dot">{unread.length > 9 ? '9+' : unread.length}</span> : null}
              </button>
              {bellOpen ? (
                <div className="popover" role="dialog" aria-label="Notifications">
                  <div className="popover-head">
                    <strong style={{ flex: 1 }}>Notifications</strong>
                    {unread.length ? (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => backend.markAllNotificationsRead()}
                      >
                        Mark all read
                      </button>
                    ) : null}
                  </div>
                  <div className="popover-list">
                    {data.notifications.length === 0 ? (
                      <div className="popover-item" style={{ cursor: 'default' }}>
                        <div>
                          <div className="pi-title">No notifications yet</div>
                          <div className="pi-body">Updates about your applications and notices appear here.</div>
                        </div>
                      </div>
                    ) : (
                      data.notifications.slice(0, 12).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className={`popover-item ${n.read_at ? '' : 'unread'}`}
                          onClick={() => {
                            backend.markNotificationRead(n.id);
                            setBellOpen(false);
                            if (n.link) navigate(n.link.replace(/^#/, ''));
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="pi-title">{n.title}</div>
                            <div className="pi-body">{n.body}</div>
                            <div className="pi-time">{fromNow(n.created_at)}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="popover-foot">
                    <a href="#/notifications">View all notifications</a>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                className="icon-button"
                aria-label="Account menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((v) => !v)}
              >
                <span className="avatar sm" aria-hidden="true">{initialLetters(session.profile.full_name)}</span>
              </button>
              {profileOpen ? (
                <div className="popover" style={{ width: 280 }} role="menu" aria-label="Account">
                  <div className="popover-head" style={{ display: 'block' }}>
                    <div style={{ fontWeight: 650 }}>{session.profile.full_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{session.profile.email}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: 4 }}>
                      {session.profile.user_code} · {roleLabel}
                    </div>
                  </div>
                  <a className="popover-item" href="#/profile" role="menuitem">
                    <Icon.Users size={16} /> Profile &amp; security
                  </a>
                  <a className="popover-item" href="#/help" role="menuitem">
                    <Icon.Help size={16} /> Help &amp; support
                  </a>
                  <button
                    className="popover-item"
                    type="button"
                    role="menuitem"
                    onClick={() => backend.signOut()}
                  >
                    <Icon.Logout size={16} /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="main" className="page" tabIndex={-1} key={route.path}>
          {backend.storageMode === 'memory' ? (
            <div className="mb">
              <Alert tone="warn" title="Preview mode — data is not saved.">
                This browser is blocking local storage (common inside an embedded preview or private
                window), so everything you change lives in memory and resets on reload. The demo works
                normally; open the published site for saving to work.
              </Alert>
            </div>
          ) : null}
          {children}
        </main>
        <footer style={{ padding: '18px 24px', color: 'var(--muted)', fontSize: '0.76rem', borderTop: '1px solid var(--line)', background: '#fff' }}>
          {data.settings.university_name} · University Application System
          {data.settings.seed_data ? ' · Demo data — not real student records' : ''}
          {' · '}
          <a href={`mailto:${data.settings.support_email}`}>Support</a>
        </footer>
      </div>
    </div>
  );
}

export function ToastStack() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span aria-hidden="true" style={{ marginTop: 2 }}>
            {t.tone === 'success' ? <Icon.CheckCircle size={17} /> : t.tone === 'error' ? <Icon.XCircle size={17} /> : <Icon.Info size={17} />}
          </span>
          <span>{t.message}</span>
          <button type="button" className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <Icon.Close size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
