import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppProvider, useApp } from './ui/context';
import { AppShell, ToastStack } from './ui/components/Layout';
import { Alert, Button, Card, EmptyState, PageHeader } from './ui/components/UI';
import { Icon } from './ui/components/Icons';
import { LoginPage, ResetPasswordPage, ActivateAccountPage } from './ui/pages/Login';
import { DashboardPage } from './ui/pages/Dashboard';
import { ApplicationsPage } from './ui/pages/Applications';
import { NewApplicationPage } from './ui/pages/NewApplication';
import { ApplicationDetailPage } from './ui/pages/ApplicationDetail';
import { InboxPage, PostHistoryPage } from './ui/pages/Queues';
import { NoticesPage, NoticeDetailPage } from './ui/pages/Notices';
import { NotificationsPage } from './ui/pages/Notifications';
import { StatisticsPage } from './ui/pages/Statistics';
import { ProfilePage } from './ui/pages/Profile';
import { SearchPage } from './ui/pages/Search';
import { HelpPage } from './ui/pages/Help';
import { AdminPage } from './ui/pages/admin/AdminPage';
import type { LocalBackend } from './backend/local';

export function App({ backend }: { backend: LocalBackend }) {
  return (
    <ErrorBoundary>
      <AppProvider backend={backend}>
        <Router />
        <ToastStack />
      </AppProvider>
    </ErrorBoundary>
  );
}

function Router() {
  const { session, route } = useApp();

  if (!session) {
    if (route.path === '/reset') return <ResetPasswordPage />;
    if (route.path === '/activate') return <ActivateAccountPage />;
    return <LoginPage />;
  }

  return (
    <AppShell>
      <Page route={route} />
    </AppShell>
  );
}

function Page({ route }: { route: ReturnType<typeof useApp>['route'] }) {
  const [first, second] = route.segments;

  switch (first) {
    case undefined:
      return <DashboardPage />;
    case 'applications':
      if (second === 'new') return <NewApplicationPage />;
      if (second) return <ApplicationDetailPage appId={second} />;
      return <ApplicationsPage />;
    case 'inbox':
      return <InboxPage />;
    case 'history':
      return <PostHistoryPage />;
    case 'notices':
      if (second) return <NoticeDetailPage noticeId={second} />;
      return <NoticesPage />;
    case 'notifications':
      return <NotificationsPage />;
    case 'statistics':
      return <StatisticsPage />;
    case 'profile':
      return <ProfilePage />;
    case 'search':
      return <SearchPage />;
    case 'help':
      return <HelpPage />;
    case 'admin':
      return <AdminPage tab={second} />;
    default:
      return <NotFoundPage />;
  }
}

function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" breadcrumbs={[{ label: 'Dashboard', to: '/' }]} />
      <Card>
        <EmptyState
          icon={<Icon.Search size={22} />}
          title="That page does not exist"
          description="The link may be out of date. Use the navigation to continue."
          action={<Button onClick={() => { window.location.hash = '#/'; }}>Back to dashboard</Button>}
        />
      </Card>
    </>
  );
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the failure visible to the user without leaking data into the console
    // beyond the stack needed to fix the bug.
    console.error('Portal render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <Card>
          <div className="card-pad stack">
            <h1>Something went wrong</h1>
            <Alert tone="danger" title="The page could not be rendered.">
              Your data has not been changed. Reload the page to continue. If this keeps happening, share the message
              below with the administrator.
            </Alert>
            <pre style={{ fontSize: '0.76rem', background: 'var(--surface-2)', padding: 12, borderRadius: 8, overflow: 'auto' }}>
              {this.state.error.message}
            </pre>
            <div className="row">
              <Button onClick={() => window.location.reload()}>Reload</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  this.setState({ error: null });
                  window.location.hash = '#/';
                }}
              >
                Try the dashboard
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }
}
