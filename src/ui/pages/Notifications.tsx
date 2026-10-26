import { useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  PageHeader,
  Select,
} from '../components/UI';
import { useApp, navigate } from '../context';
import { formatDateTime, fromNow } from '../lib/format';

export function NotificationsPage() {
  const { data, backend } = useApp();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');

  const rows = data.notifications.filter((n) => {
    if (filter === 'unread' && n.read_at) return false;
    if (category && n.category !== category) return false;
    return true;
  });
  const unread = data.notifications.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Persistent history of application, notice and assignment events addressed to you."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Notifications' }]}
        actions={
          unread ? (
            <Button variant="secondary" onClick={() => backend.markAllNotificationsRead()}>
              <Icon.Check size={15} /> Mark all read
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title={`${rows.length} notification${rows.length === 1 ? '' : 's'}`} subtitle={`${unread} unread`} />
        <div className="card-pad">
          <div className="filters" style={{ marginBottom: 14 }}>
            <Field label="Show" htmlFor="notif-filter">
              <Select id="notif-filter" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'unread')}>
                <option value="all">All notifications</option>
                <option value="unread">Unread only</option>
              </Select>
            </Field>
            <Field label="Category" htmlFor="notif-category">
              <Select id="notif-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                <option value="application">Applications</option>
                <option value="notice">Notices</option>
                <option value="assignment">Assignments</option>
                <option value="retention">Retention</option>
                <option value="system">System</option>
              </Select>
            </Field>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<Icon.Bell size={22} />} title="Nothing here" description="Notifications about your applications, approvals, notices and assignments appear here." />
          ) : (
            <div className="stack sm">
              {rows.map((n) => (
                <div
                  key={n.id}
                  className="card"
                  style={{ padding: 14, boxShadow: 'none', background: n.read_at ? '#fff' : '#f7faff' }}
                >
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span className="stat-icon" style={{ width: 32, height: 32, flex: '0 0 32px' }}>
                      {n.category === 'notice' ? <Icon.Book size={15} /> : n.category === 'assignment' ? <Icon.Shield size={15} /> : n.category === 'retention' ? <Icon.Archive size={15} /> : <Icon.File size={15} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row tight">
                        <strong style={{ fontSize: '0.88rem' }}>{n.title}</strong>
                        {!n.read_at ? <Chip tone="info">Unread</Chip> : null}
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--ink-2)', marginTop: 3 }}>{n.body}</p>
                      <div className="cell-sub" style={{ marginTop: 4 }}>
                        {formatDateTime(n.created_at)} · {fromNow(n.created_at)}
                      </div>
                    </div>
                    <div className="stack sm" style={{ alignItems: 'flex-end' }}>
                      {n.link ? (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            backend.markNotificationRead(n.id);
                            navigate(n.link!.replace(/^#/, ''));
                          }}
                        >
                          Open
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => backend.markNotificationRead(n.id, !n.read_at)}
                      >
                        Mark {n.read_at ? 'unread' : 'read'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
