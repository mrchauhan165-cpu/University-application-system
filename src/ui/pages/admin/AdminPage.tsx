import { Card, EmptyState, PageHeader, Tabs } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp, useSession, navigate } from '../../context';
import type { Permission } from '../../../domain/types';
import { StructureTab } from './StructureTab';
import { PostsTab } from './PostsTab';
import { UsersTab } from './UsersTab';
import { AssignmentsTab } from './AssignmentsTab';
import { TypesTab } from './TypesTab';
import { WorkflowsTab } from './WorkflowsTab';
import { RetentionTab } from './RetentionTab';
import { AuditTab } from './AuditTab';
import { SettingsTab } from './SettingsTab';

type TabId =
  | 'structure'
  | 'users'
  | 'assignments'
  | 'posts'
  | 'types'
  | 'workflows'
  | 'retention'
  | 'audit'
  | 'settings';

const TAB_META: { id: TabId; label: string; permission: Permission }[] = [
  { id: 'structure', label: 'Organisation', permission: 'user.manage' },
  { id: 'users', label: 'Users', permission: 'user.manage' },
  { id: 'assignments', label: 'Post assignments', permission: 'user.manage' },
  { id: 'posts', label: 'Posts & permissions', permission: 'user.manage' },
  { id: 'types', label: 'Application types', permission: 'workflow.configure' },
  { id: 'workflows', label: 'Workflows', permission: 'workflow.configure' },
  { id: 'retention', label: 'Retention', permission: 'retention.manage' },
  { id: 'audit', label: 'Audit log', permission: 'audit.view' },
  { id: 'settings', label: 'Settings', permission: 'system.admin' },
];

export function AdminPage({ tab }: { tab?: string }) {
  const { route } = useApp();
  const session = useSession();
  const allowed = TAB_META.filter((t) => session.permissions.includes(t.permission));
  const active = (allowed.find((t) => t.id === tab)?.id ?? allowed[0]?.id) as TabId | undefined;

  if (!allowed.length) {
    return (
      <>
        <PageHeader title="Administration" breadcrumbs={[{ label: 'Dashboard', to: '/' }]} />
        <Card>
          <EmptyState
            icon={<Icon.Lock size={22} />}
            title="You do not have administrative permissions"
            description="Administration is limited to posts with explicit management permissions. Being senior or having a title does not grant access."
          />
        </Card>
      </>
    );
  }

  const visiblePath = route.segments[1];
  if (!allowed.some((t) => t.id === visiblePath) && visiblePath !== undefined) {
    // Keep the URL honest: send the user to a tab they may use.
    queueMicrotask(() => navigate(`/admin/${allowed[0].id}`));
  }

  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Structure, accounts, assignments, workflows, retention and audit."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Administration' }]}
      />
      <Card>
        <div style={{ padding: '0 8px' }}>
          <Tabs
            tabs={allowed.map((t) => ({ id: t.id, label: t.label }))}
            active={(active ?? allowed[0].id) as TabId}
            onChange={(id) => navigate(`/admin/${id}`)}
          />
        </div>
        <div className="card-pad">
          {active === 'structure' ? <StructureTab /> : null}
          {active === 'users' ? <UsersTab /> : null}
          {active === 'assignments' ? <AssignmentsTab /> : null}
          {active === 'posts' ? <PostsTab /> : null}
          {active === 'types' ? <TypesTab /> : null}
          {active === 'workflows' ? <WorkflowsTab /> : null}
          {active === 'retention' ? <RetentionTab /> : null}
          {active === 'audit' ? <AuditTab /> : null}
          {active === 'settings' ? <SettingsTab /> : null}
        </div>
      </Card>
    </>
  );
}
