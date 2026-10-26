import { useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
  StatusChip,
  TextInput,
} from '../components/UI';
import { useApp, useSession } from '../context';
import { formatDate, fromNow } from '../lib/format';
import { applicationOrgText, myApplications, typeName } from '../lib/selectors';
import { STATUS_LABEL, type AppStatus } from '../../domain/types';

const STATUS_FILTERS: { value: string; label: string; match: (s: AppStatus) => boolean }[] = [
  { value: '', label: 'All statuses', match: () => true },
  { value: 'draft', label: 'Draft', match: (s) => s === 'draft' },
  { value: 'open', label: 'Pending decision', match: (s) => ['submitted', 'under_review', 'resubmitted', 'further_pending'].includes(s) },
  { value: 'returned', label: 'Returned for correction', match: (s) => s === 'returned' },
  { value: 'completed', label: 'Completed', match: (s) => s === 'completed' || s === 'approved' },
  { value: 'rejected', label: 'Rejected', match: (s) => s === 'rejected' },
  { value: 'withdrawn', label: 'Withdrawn', match: (s) => s === 'withdrawn' },
];

export function ApplicationsPage() {
  const { data } = useApp();
  const session = useSession();
  const [status, setStatus] = useState('');
  const [typeId, setTypeId] = useState('');
  const [query, setQuery] = useState('');

  const mine = myApplications(data, session);
  const filter = STATUS_FILTERS.find((f) => f.value === status)!;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mine.filter((app) => {
      if (!filter.match(app.status)) return false;
      if (typeId && app.application_type_id !== typeId) return false;
      if (q) {
        const haystack = `${app.reference} ${typeName(data, app.application_type_id)} ${app.status}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [mine, filter, typeId, query, data]);

  const availableTypes = data.applicationTypes.filter(
    (t) => t.active && t.applicant_kinds.includes(session.profile.kind),
  );

  return (
    <>
      <PageHeader
        title="My applications"
        subtitle="Every application you submitted, with its current status and your own documents."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'My applications' }]}
        actions={
          availableTypes.length ? (
            <Button onClick={() => { window.location.hash = '#/applications/new'; }}>
              <Icon.Plus size={16} /> New application
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title={`${rows.length} application${rows.length === 1 ? '' : 's'}`} subtitle="Only your own records are ever returned by the server." />
        <div className="card-pad">
          <div className="filters" style={{ marginBottom: 14 }}>
            <Field label="Search" htmlFor="app-search" className="grow">
              <TextInput
                id="app-search"
                type="search"
                placeholder="Reference number or type"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <Field label="Status" htmlFor="status-filter">
              <Select id="status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Application type" htmlFor="type-filter">
              <Select id="type-filter" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">All types</option>
                {data.applicationTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.File size={22} />}
              title={mine.length ? 'No applications match these filters' : 'No applications yet'}
              description={
                mine.length
                  ? 'Try a different status, type or search term.'
                  : 'When you submit an application it will appear here with its live status.'
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
                    <th>Last update</th>
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
                        <div className="cell-sub">{applicationOrgText(data, app)}</div>
                      </td>
                      <td data-label="Submitted">{app.submitted_at ? formatDate(app.submitted_at) : 'Not submitted'}</td>
                      <td data-label="Last update">{fromNow(app.updated_at)}</td>
                      <td data-label="Status">
                        <StatusChip status={app.status} label={STATUS_LABEL[app.status]} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Button size="small" variant="secondary" onClick={() => { window.location.hash = `#/applications/${app.id}`; }}>
                          Open
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
