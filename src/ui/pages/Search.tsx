import { useState } from 'react';
import { Icon } from '../components/Icons';
import { Button, Card, CardHeader, Chip, EmptyState, Field, PageHeader, StatusChip, TextInput } from '../components/UI';
import { useApp, navigate } from '../context';
import { formatDate } from '../lib/format';
import { typeName } from '../lib/selectors';

export function SearchPage() {
  const { data, route } = useApp();
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const q = (route.query.get('q') ?? query).trim().toLowerCase();

  const apps = q
    ? data.applications.filter((app) =>
        `${app.reference} ${app.applicant_name} ${app.applicant_code} ${typeName(data, app.application_type_id)} ${app.status}`
          .toLowerCase()
          .includes(q),
      )
    : [];
  const notices = q
    ? data.notices.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q))
    : [];

  return (
    <>
      <PageHeader
        title="Search"
        subtitle={q ? `Results for “${route.query.get('q') ?? query}” — only records you are authorised to read.` : 'Search your own applications, permitted officer records and notices.'}
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Search' }]}
      />

      <Card>
        <div className="card-pad">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Field label="Search applications and notices" htmlFor="search-input">
              <div className="row" style={{ gap: 8 }}>
                <TextInput id="search-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Reference, applicant, type or notice text" />
                <Button type="submit"><Icon.Search size={15} /> Search</Button>
              </div>
            </Field>
          </form>
        </div>
      </Card>

      {!q ? null : apps.length === 0 && notices.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon.Search size={22} />}
            title="No matching records"
            description="Nothing you can access matches this search. Records outside your scope are never included."
          />
        </Card>
      ) : (
        <div className="stack">
          <Card>
            <CardHeader title={`Applications (${apps.length})`} subtitle="Only applications visible to your current role and scope." />
            {apps.length === 0 ? (
              <div className="card-pad"><p className="cell-sub">No matching applications.</p></div>
            ) : (
              <div className="table-wrap responsive">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Application</th>
                      <th>Applicant</th>
                      <th>Submitted</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {apps.slice(0, 30).map((app) => (
                      <tr key={app.id}>
                        <td data-label="Application">
                          <div className="cell-title">{typeName(data, app.application_type_id)}</div>
                          <div className="cell-sub mono">{app.reference}</div>
                        </td>
                        <td data-label="Applicant">{app.applicant_name}</td>
                        <td data-label="Submitted">{formatDate(app.submitted_at)}</td>
                        <td data-label="Status"><StatusChip status={app.status} /></td>
                        <td style={{ textAlign: 'right' }}>
                          <Button size="small" variant="secondary" onClick={() => navigate(`/applications/${app.id}`)}>Open</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={`Notices (${notices.length})`} />
            {notices.length === 0 ? (
              <div className="card-pad"><p className="cell-sub">No matching notices.</p></div>
            ) : (
              <div>
                {notices.map((n) => (
                  <a key={n.id} href={`#/notices/${n.id}`} className="popover-item" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pi-title">{n.title}</div>
                      <div className="pi-body">{n.scope_label} · {formatDate(n.publish_at)}</div>
                    </div>
                    <Chip tone="neutral">{n.status}</Chip>
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
