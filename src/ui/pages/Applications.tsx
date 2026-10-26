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
import { applicationOrgText, applicationSteps, myApplications, typeName } from '../lib/selectors';
import { ProgressDots } from '../components/Progress';
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

  const filterCounts = STATUS_FILTERS.map((f) => ({ ...f, count: mine.filter((a) => f.match(a.status)).length }));

  const availableTypes = session.canSubmit
    ? data.applicationTypes.filter((t) => t.active && t.applicant_kinds.includes(session.profile.kind))
    : [];

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
          <div className="filter-bar">
            <div className="segmented" role="group" aria-label="Filter by status">
              {filterCounts.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`seg ${status === f.value ? 'is-active' : ''}`}
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                >
                  {f.label}
                  <span className="seg-count">{f.count}</span>
                </button>
              ))}
            </div>
            <div className="filters">
              <Field label="Search" htmlFor="app-search" className="grow">
                <TextInput
                  id="app-search"
                  type="search"
                  placeholder="Reference number or type"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
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
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<Icon.File size={22} />}
              title={mine.length ? 'No applications match these filters' : 'No applications yet'}
              description={
                mine.length
                  ? 'Try a different status, type or search term.'
                  : session.canSubmit
                    ? 'When you submit an application it will appear here with its live status.'
                    : 'Your post approves applications but never raises them, so there is nothing to list here.'
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
                        <div className="row tight">
                          <StatusChip status={app.status} label={STATUS_LABEL[app.status]} />
                          <ProgressDots steps={applicationSteps(data, app)} />
                        </div>
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
