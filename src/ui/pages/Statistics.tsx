import { useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Alert,
  BarRow,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  PermissionDenied,
  Select,
  StatCard,
  StatusChip,
  TextInput,
} from '../components/UI';
import { useApp, useSession } from '../context';
import { days, downloadCsv, formatDate } from '../lib/format';
import { computeStats, statisticsScope } from '../../backend/select';
import { typeName } from '../lib/selectors';

export function StatisticsPage() {
  const { data, backend, notify } = useApp();
  const session = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typeId, setTypeId] = useState('');
  const [status, setStatus] = useState('');

  const scope = useMemo(() => statisticsScope(data, session), [data, session]);

  if (!session.permissions.includes('statistics.view') || !scope) {
    return (
      <>
        <PageHeader title="Statistics" breadcrumbs={[{ label: 'Dashboard', to: '/' }]} />
        <PermissionDenied what="statistics" />
      </>
    );
  }

  const activeScope = scope as NonNullable<typeof scope>;
  const stats = computeStats(data, activeScope.apps, { from, to, typeId, status }, activeScope.label);
  const smallGroup = stats.total > 0 && stats.total < 5;
  const maxStatus = Math.max(1, ...stats.byStatus.map((b) => b.count));
  const maxType = Math.max(1, ...stats.byType.map((b) => b.count));
  const maxPost = Math.max(1, ...stats.byPost.map((b) => b.count));
  const publishedNotices = data.notices.filter((n) => n.status === 'published');
  const readNotices = data.noticeReads.length;

  function exportCsv() {
    const rows: (string | number | null)[][] = [
      ['Reference', 'Type', 'Applicant', 'Department', 'Batch', 'Section', 'Status', 'Submitted', 'Decided'],
      ...stats.applications.map((app) => [
        app.reference,
        typeName(data, app.application_type_id),
        app.applicant_name,
        app.org.department_name ?? '',
        app.org.batch_label ?? '',
        app.org.section_name ?? '',
        app.status,
        app.submitted_at ?? '',
        app.decided_at ?? '',
      ]),
    ];
    downloadCsv(`applications-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    try {
      backend.recordExport(`applications CSV (${stats.applications.length} rows, scope: ${activeScope.label})`);
    } catch {
      /* exporting is still allowed; the audit write failed silently */
    }
    notify('Export created. Exports are recorded in the audit log.', 'success');
  }

  return (
    <>
      <PageHeader
        title="Statistics"
        subtitle={`Aggregated from live database records · scope: ${activeScope.label}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Statistics' }]}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!stats.applications.length}>
            <Icon.Download size={15} /> Export CSV
          </Button>
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Alert tone="info" title="Scope-limited by design.">
          Your post limits which applications are included. Aggregates are computed from the same permission-filtered
          records you can open — never from the whole university.
        </Alert>
      </div>

      <Card>
        <CardHeader title="Filters" subtitle="Applied to the records before aggregation." />
        <div className="card-pad">
          <div className="filters">
            <Field label="From" htmlFor="stat-from">
              <TextInput id="stat-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="stat-to">
              <TextInput id="stat-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Application type" htmlFor="stat-type">
              <Select id="stat-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">All types</option>
                {data.applicationTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="stat-status">
              <Select id="stat-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under review</option>
                <option value="returned">Returned</option>
                <option value="further_pending">Further approval pending</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
              </Select>
            </Field>
            {(from || to || typeId || status) ? (
              <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); setTypeId(''); setStatus(''); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid cols-4" style={{ margin: '16px 0' }}>
        <StatCard label="Applications received" value={stats.total} hint={from || to ? `${formatDate(from || null)} → ${formatDate(to || null)}` : 'All time'} icon={<Icon.File size={16} />} />
        <StatCard label="Pending" value={stats.pending} tone="warn" hint="In progress at any stage" icon={<Icon.Clock size={16} />} />
        <StatCard label="Completed" value={stats.approved} tone="success" hint="Approved or finalised" icon={<Icon.CheckCircle size={16} />} />
        <StatCard label="Rejected" value={stats.rejected} tone="danger" hint={`${stats.returned} returned for correction`} icon={<Icon.XCircle size={16} />} />
      </div>

      {stats.total === 0 ? (
        <Card>
          <EmptyState icon={<Icon.Chart size={22} />} title="No data for these filters" description="Adjust the date range or filters. Only records inside your scope are counted." />
        </Card>
      ) : (
        <>
          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <Card>
              <CardHeader title="By status" />
              <div className="card-pad bar-list">
                {stats.byStatus.map((bucket) => (
                  <BarRow
                    key={bucket.key}
                    label={bucket.label}
                    value={bucket.count}
                    max={maxStatus}
                    tone={bucket.key === 'rejected' ? 'danger' : bucket.key === 'completed' ? 'success' : ['returned', 'further_pending'].includes(bucket.key) ? 'warn' : undefined}
                  />
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="By application type" />
              <div className="card-pad bar-list">
                {stats.byType.map((bucket) => (
                  <BarRow key={bucket.key} label={bucket.label} value={bucket.count} max={maxType} />
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Awaiting action by post" subtitle="Where applications are currently sitting." />
              <div className="card-pad bar-list">
                {stats.byPost.length === 0 ? (
                  <p className="cell-sub">No applications are currently waiting at a post.</p>
                ) : (
                  stats.byPost.map((bucket) => <BarRow key={bucket.key} label={bucket.label} value={bucket.count} max={maxPost} tone="warn" />)
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Processing time" subtitle="Measured from submission to final decision." />
              <div className="card-pad">
                <div className="grid cols-2">
                  <div>
                    <div className="stat-label">Average</div>
                    <div className="stat-value">{days(stats.avgProcessingDays)}</div>
                  </div>
                  <div>
                    <div className="stat-label">Median</div>
                    <div className="stat-value">{days(stats.medianProcessingDays)}</div>
                  </div>
                </div>
                <p className="cell-sub" style={{ marginTop: 12 }}>
                  Based on {stats.applications.filter((a) => a.decided_at).length} completed decision
                  {stats.applications.filter((a) => a.decided_at).length === 1 ? '' : 's'}. Small samples are shown as
                  hours.
                </p>
              </div>
            </Card>
          </div>

          <div className="grid cols-2" style={{ marginTop: 16, alignItems: 'start' }}>
            <Card>
              <CardHeader title="Notices" subtitle="Published notices visible in your scope." />
              <div className="card-pad">
                <div className="grid cols-2">
                  <div>
                    <div className="stat-label">Published</div>
                    <div className="stat-value">{publishedNotices.length}</div>
                  </div>
                  <div>
                    <div className="stat-label">Read by you</div>
                    <div className="stat-value">{readNotices}</div>
                  </div>
                </div>
                <p className="cell-sub" style={{ marginTop: 12 }}>
                  Read receipts are stored per user. University-wide read rates require an aggregate report permission
                  and are not exposed by this view.
                </p>
              </div>
            </Card>
            <Card>
              <CardHeader title="Privacy" subtitle="Protecting small groups." />
              <div className="card-pad">
                {smallGroup ? (
                  <Alert tone="warn" title="Very small group.">
                    Only {stats.total} record{stats.total === 1 ? '' : 's'} match your filters. The per-post breakdown is
                    hidden to avoid identifying individuals. Widen the filters for a fuller picture.
                  </Alert>
                ) : (
                  <Alert tone="success" title="Aggregation threshold met.">
                    Counts are shown because the filtered set is large enough not to identify an individual.
                  </Alert>
                )}
                <p className="cell-sub" style={{ marginTop: 10 }}>
                  Confidential application contents are never included in statistics. Only counts and timings are
                  aggregated.
                </p>
              </div>
            </Card>
          </div>

          <Card className="card" >
            <CardHeader title="Records included" subtitle={`${stats.applications.length} record(s) in ${activeScope.label}`} />
            <div className="table-wrap responsive">
              <table className="data">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Type</th>
                    <th>Applicant</th>
                    <th>Submitted</th>
                    <th>Decided</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.applications.slice(0, 40).map((app) => (
                    <tr key={app.id}>
                      <td data-label="Reference" className="mono">{app.reference}</td>
                      <td data-label="Type">{typeName(data, app.application_type_id)}</td>
                      <td data-label="Applicant">{app.applicant_code}</td>
                      <td data-label="Submitted">{formatDate(app.submitted_at)}</td>
                      <td data-label="Decided">{formatDate(app.decided_at)}</td>
                      <td data-label="Status"><StatusChip status={app.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stats.applications.length > 40 ? (
              <div className="card-footer">
                <span className="cell-sub">Showing the first 40 of {stats.applications.length}. Export CSV for the full permitted set.</span>
              </div>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
