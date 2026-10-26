import { useMemo, useState } from 'react';
import { Alert, Button, Card, Chip, Field, Select, TextInput } from '../../components/UI';
import { useApp } from '../../context';
import { formatDateTime } from '../../lib/format';
import { humanise } from '../../lib/format';

export function AuditTab() {
  const { data } = useApp();
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState('');

  const entities = useMemo(() => [...new Set(data.audit.map((a) => a.entity))].sort(), [data.audit]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.audit.filter((entry) => {
      if (entity && entry.entity !== entity) return false;
      if (q) {
        const haystack = `${entry.action} ${entry.actor_name} ${entry.entity} ${entry.entity_id ?? ''} ${JSON.stringify(entry.meta ?? {})}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data.audit, query, entity]);

  return (
    <div className="stack">
      <Alert tone="info" title="Audit entries are append-only in this view.">
        They record who did what, in which post, and when. Application decisions additionally keep a permanent action
        record attached to the application.
      </Alert>

      <div className="filters">
        <Field label="Search" htmlFor="audit-search" className="grow">
          <TextInput id="audit-search" type="search" placeholder="Action, actor, entity or details" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field label="Entity" htmlFor="audit-entity">
          <Select id="audit-entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e} value={e}>{humanise(e)}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Card>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((entry) => (
                <tr key={entry.id}>
                  <td className="cell-sub" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.created_at)}</td>
                  <td>{entry.actor_name}</td>
                  <td><Chip tone="neutral">{humanise(entry.action)}</Chip></td>
                  <td className="cell-sub">{humanise(entry.entity)}</td>
                  <td className="cell-sub" style={{ maxWidth: 360 }}>
                    {entry.meta ? (
                      <code style={{ fontSize: '0.74rem', wordBreak: 'break-word' }}>{JSON.stringify(entry.meta)}</code>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="card-pad cell-sub">No audit entries match these filters.</p> : null}
        {rows.length > 200 ? <p className="card-pad cell-sub">Showing the 200 most recent of {rows.length} entries.</p> : null}
      </Card>

      <div className="row">
        <Button variant="secondary" size="small" onClick={() => window.print()}>Print this view</Button>
        <span className="cell-sub">Only posts with the audit permission can open this page.</span>
      </div>
    </div>
  );
}
