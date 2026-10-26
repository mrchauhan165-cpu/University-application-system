import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Select,
  StatusChip,
  TextArea,
  TextInput,
} from '../components/UI';
import { DocumentViewer } from '../components/DocumentViewer';
import { useApp, useSession, navigate } from '../context';
import { errorMessage } from '../../backend/errors';
import { bytes, formatDate, formatDateTime, fromNow } from '../lib/format';
import { publishableScopes } from '../../backend/ops/notices';
import type { Scope, ScopeType } from '../../domain/types';
import { NOTICE_AUDIENCE, SCOPE_TYPES } from '../lib/constants';

export function NoticesPage() {
  const { data, backend, notify } = useApp();
  const session = useSession();
  const [scopeFilter, setScopeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showRead, setShowRead] = useState<'all' | 'unread'>('all');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);

  const readIds = new Set(data.noticeReads.map((r) => r.notice_id));
  const options = publishableScopes(data, session.grants);
  const canPublish = options.length > 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.notices
      .filter((n) => {
        if (n.status === 'archived') return false;
        if (scopeFilter && n.scope_type !== scopeFilter) return false;
        if (showRead === 'unread' && (readIds.has(n.id) || n.status !== 'published')) return false;
        if (q && !`${n.title} ${n.body}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => ((a.publish_at ?? a.created_at) < (b.publish_at ?? b.created_at) ? 1 : -1));
  }, [data.notices, scopeFilter, query, showRead, readIds]);

  const drafts = data.notices.filter((n) => n.status === 'draft' || n.status === 'scheduled');

  return (
    <>
      <PageHeader
        title="Notices"
        subtitle="Notices are shown only when your faculty, department, batch or section is in the audience."
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Notices' }]}
        actions={
          canPublish ? (
            <Button onClick={() => setEditing('new')}>
              <Icon.Plus size={16} /> New notice
            </Button>
          ) : undefined
        }
      />

      {canPublish ? (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info" title="Your publishing scope:">
            {options.map((o) => o.label).join(' · ')}
          </Alert>
        </div>
      ) : null}

      {drafts.length ? (
        <Card className="card" >
          <CardHeader title="Drafts & scheduled" subtitle="Visible to you as the publisher until they are published." />
          <div>
            {drafts.map((notice) => (
              <div key={notice.id} className="popover-item" style={{ cursor: 'default' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pi-title">{notice.title}</div>
                  <div className="pi-body">
                    {notice.scope_label} · {notice.status === 'scheduled' ? `publishes ${formatDateTime(notice.publish_at)}` : 'draft'} ·{' '}
                    updated {fromNow(notice.updated_at)}
                  </div>
                </div>
                <StatusChip status={notice.status} />
                <Button size="small" variant="secondary" onClick={() => setEditing(notice.id)}>Edit</Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`${rows.length} notice${rows.length === 1 ? '' : 's'}`} subtitle="Newest first" />
        <div className="card-pad">
          <div className="filters" style={{ marginBottom: 14 }}>
            <Field label="Search notices" htmlFor="notice-search" className="grow">
              <TextInput id="notice-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title or content" />
            </Field>
            <Field label="Audience scope" htmlFor="notice-scope">
              <Select id="notice-scope" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
                <option value="">All scopes</option>
                {SCOPE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Show" htmlFor="notice-read">
              <Select id="notice-read" value={showRead} onChange={(e) => setShowRead(e.target.value as 'all' | 'unread')}>
                <option value="all">All notices</option>
                <option value="unread">Unread only</option>
              </Select>
            </Field>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<Icon.Book size={22} />} title="No notices to show" description="When a notice is published for your scope it appears here." />
          ) : (
            <div className="stack sm">
              {rows.map((notice) => (
                <div key={notice.id} className="card" style={{ padding: 16, boxShadow: 'none' }}>
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row tight" style={{ marginBottom: 4 }}>
                        {!readIds.has(notice.id) && notice.status === 'published' ? <Chip tone="info">New</Chip> : null}
                        <Chip tone="neutral">{notice.scope_type === 'university' ? 'University' : notice.scope_type}</Chip>
                        <Chip tone="neutral">{NOTICE_AUDIENCE[notice.audience]}</Chip>
                        {notice.status !== 'published' ? <StatusChip status={notice.status} /> : null}
                      </div>
                      <a href={`#/notices/${notice.id}`} style={{ color: 'var(--ink)', fontWeight: 650, fontSize: '1rem' }}>
                        {notice.title}
                      </a>
                      <div className="cell-sub" style={{ marginTop: 4 }}>
                        {notice.scope_label} · {notice.creator_name}
                        {notice.publish_at ? ` · ${formatDate(notice.publish_at)}` : ''}
                        {notice.expires_at ? ` · expires ${formatDate(notice.expires_at)}` : ''}
                      </div>
                      <p style={{ marginTop: 8, fontSize: '0.88rem', color: 'var(--ink-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {notice.body}
                      </p>
                    </div>
                    <div className="stack sm" style={{ alignItems: 'flex-end' }}>
                      <Button size="small" variant="secondary" onClick={() => navigate(`/notices/${notice.id}`)}>Open</Button>
                      {notice.attachments.length ? (
                        <Button size="small" variant="ghost" onClick={() => setDocId(notice.attachments[0].id)}>
                          <Icon.File size={13} /> {notice.attachments.length} file(s)
                        </Button>
                      ) : null}
                      {notice.created_by === session.profile.id || canPublish ? (
                        <Button size="small" variant="ghost" onClick={() => setEditing(notice.id)}>Manage</Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {editing ? (
        <NoticeEditor
          noticeId={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify('Notice saved.', 'success');
          }}
          onError={(m) => notify(m, 'error')}
          backend={backend}
          options={options}
        />
      ) : null}

      {docId ? <DocumentViewer docId={docId} onClose={() => setDocId(null)} /> : null}
    </>
  );
}

export function NoticeDetailPage({ noticeId }: { noticeId: string }) {
  const { data, backend, notify } = useApp();
  const session = useSession();
  const notice = data.notices.find((n) => n.id === noticeId);
  const [docId, setDocId] = useState<string | null>(null);

  const isRead = data.noticeReads.some((r) => r.notice_id === noticeId);
  useEffect(() => {
    if (notice && !isRead && notice.status === 'published') {
      try {
        backend.markNoticeRead(notice.id);
      } catch {
        /* read receipts are best-effort */
      }
    }
  }, [notice, isRead, backend]);

  if (!notice) {
    return (
      <>
        <PageHeader title="Notice unavailable" breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Notices', to: '/notices' }]} />
        <Card>
          <EmptyState
            icon={<Icon.Lock size={22} />}
            title="This notice is not available to you"
            description="Notices are limited to their configured audience and organisational scope."
            action={<Button onClick={() => navigate('/notices')}>Back to notices</Button>}
          />
        </Card>
      </>
    );
  }

  const canManage =
    notice.created_by === session.profile.id ||
    session.permissions.includes('notice.university');

  return (
    <>
      <PageHeader
        title={notice.title}
        subtitle={`${notice.scope_label} · ${NOTICE_AUDIENCE[notice.audience]} · published ${formatDate(notice.publish_at)}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Notices', to: '/notices' }, { label: 'Notice' }]}
        actions={
          canManage ? (
            <>
              {notice.status === 'draft' || notice.status === 'scheduled' ? (
                <Button
                  onClick={() => {
                    try {
                      backend.publishNotice(notice.id);
                      notify('Notice published.', 'success');
                    } catch (err) {
                      notify(errorMessage(err), 'error');
                    }
                  }}
                >
                  <Icon.Send size={15} /> Publish now
                </Button>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    backend.archiveNotice(notice.id);
                    notify('Notice archived.', 'info');
                    navigate('/notices');
                  } catch (err) {
                    notify(errorMessage(err), 'error');
                  }
                }}
              >
                Archive
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader title="Notice" actions={<StatusChip status={notice.status} />} />
          <div className="card-pad">
            <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.92rem', lineHeight: 1.75, color: 'var(--ink-2)' }}>{notice.body}</p>
            {notice.attachments.length ? (
              <div className="stack sm" style={{ marginTop: 16 }}>
                {notice.attachments.map((doc) => (
                  <div key={doc.id} className="row" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                    <Icon.File size={16} />
                    <span style={{ flex: 1, fontSize: '0.86rem' }}>{doc.file_name}</span>
                    <span className="cell-sub">{bytes(doc.size)}</span>
                    <Button size="small" variant="secondary" onClick={() => setDocId(doc.id)}>
                      <Icon.Eye size={13} /> Open
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Publishing details" subtitle="Authorship is historical and is not rewritten when assignments change." />
          <div className="card-pad">
            <dl className="kv">
              <dt>Published by</dt>
              <dd>{notice.creator_name} ({notice.creator_code}){notice.creator_post ? ` · ${notice.creator_post}` : ''}</dd>
              <dt>Scope</dt>
              <dd>{notice.scope_label}</dd>
              <dt>Audience</dt>
              <dd>{NOTICE_AUDIENCE[notice.audience]}</dd>
              <dt>Published</dt>
              <dd>{formatDateTime(notice.publish_at)}</dd>
              <dt>Expires</dt>
              <dd>{notice.expires_at ? formatDateTime(notice.expires_at) : 'No expiry'}</dd>
              <dt>Version</dt>
              <dd>{notice.version}</dd>
              <dt>Last updated</dt>
              <dd>{fromNow(notice.updated_at)}</dd>
            </dl>
            <div style={{ marginTop: 14 }}>
              <Alert tone="info">
                Read receipts are recorded per user and are visible only in aggregate statistics.
              </Alert>
            </div>
          </div>
        </Card>
      </div>

      {docId ? <DocumentViewer docId={docId} onClose={() => setDocId(null)} /> : null}
    </>
  );
}

function NoticeEditor({
  noticeId,
  onClose,
  onSaved,
  onError,
  backend,
  options,
}: {
  noticeId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  backend: ReturnType<typeof useApp>['backend'];
  options: ReturnType<typeof publishableScopes>;
}) {
  const { data } = useApp();
  const existing = noticeId ? data.notices.find((n) => n.id === noticeId) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [scopeKey, setScopeKey] = useState(
    existing ? `${existing.scope_type}` : options[0] ? options[0].scope_type : 'university',
  );
  const [audience, setAudience] = useState<'students' | 'staff' | 'everyone'>(existing?.audience ?? 'students');
  const [publishAt, setPublishAt] = useState(existing?.publish_at ? existing.publish_at.slice(0, 16) : '');
  const [expiresAt, setExpiresAt] = useState(existing?.expires_at ? existing.expires_at.slice(0, 16) : '');
  const [busy, setBusy] = useState(false);
  const [attachmentDoc, setAttachmentDoc] = useState<string | null>(null);

  const chosen = options.find((o) => o.scope_type === scopeKey) ?? options[0];
  const scope: Scope = existing && existing.scope_type === scopeKey ? existing.scope : chosen?.scope ?? {};

  function save(publish: boolean) {
    setBusy(true);
    try {
      const notice = backend.saveNotice({
        id: noticeId ?? undefined,
        title,
        body,
        scope_type: scopeKey as ScopeType,
        scope,
        audience,
        publish_at: publishAt ? new Date(publishAt).toISOString() : null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        status: publish ? 'published' : 'draft',
      });
      if (publish) backend.publishNotice(notice.id);
      onSaved();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File | undefined) {
    if (!file || !noticeId) return;
    try {
      await backend.attachNoticeFile(noticeId, file);
      onSaved();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  const attachments = existing?.attachments ?? [];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={noticeId ? 'Manage notice' : 'Create a notice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save draft</Button>
          <Button disabled={busy} onClick={() => save(true)}>
            <Icon.Send size={15} /> {publishAt ? 'Schedule' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Title" htmlFor="notice-title" required>
          <TextInput id="notice-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Content" htmlFor="notice-body" required hint="Plain text. Line breaks are preserved.">
          <TextArea id="notice-body" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 180 }} maxLength={20000} />
        </Field>
        <div className="form-grid">
          <Field label="Audience scope" htmlFor="notice-scope-select" hint="Limited to the scopes your current post may publish to.">
            <Select id="notice-scope-select" value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
              {options.map((o) => (
                <option key={`${o.scope_type}-${o.label}`} value={o.scope_type}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Audience" htmlFor="notice-audience">
            <Select id="notice-audience" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
              <option value="students">Students</option>
              <option value="staff">Staff &amp; faculty</option>
              <option value="everyone">Everyone</option>
            </Select>
          </Field>
          <Field label="Publish at (optional)" htmlFor="notice-publish" hint="Leave blank to publish immediately.">
            <TextInput id="notice-publish" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </Field>
          <Field label="Expires at (optional)" htmlFor="notice-expiry">
            <TextInput id="notice-expiry" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>

        {noticeId ? (
          <fieldset>
            <legend>Attachments (PDF, PNG, JPEG · max 2 MB)</legend>
            {attachments.map((doc) => (
              <div key={doc.id} className="row" style={{ gap: 8, marginBottom: 6 }}>
                <Icon.File size={15} />
                <span style={{ flex: 1, fontSize: '0.84rem' }}>{doc.file_name}</span>
                <Button size="small" variant="secondary" onClick={() => setAttachmentDoc(doc.id)}>Open</Button>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => {
                    try {
                      backend.removeNoticeAttachment(noticeId, doc.id);
                      onSaved();
                    } catch (err) {
                      onError(errorMessage(err));
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <label className="btn secondary small" style={{ cursor: 'pointer' }}>
              <Icon.Upload size={14} /> Attach file
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => {
                  void attach(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </fieldset>
        ) : (
          <Alert tone="info">Save the notice as a draft first to add attachments.</Alert>
        )}
      </div>
      {attachmentDoc ? <DocumentViewer docId={attachmentDoc} onClose={() => setAttachmentDoc(null)} /> : null}
    </Modal>
  );
}
