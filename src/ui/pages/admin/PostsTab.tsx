import { useState } from 'react';
import { Alert, Button, Chip, Field, Modal, Select, TextInput } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useApp } from '../../context';
import { errorMessage } from '../../../backend/errors';
import { humanise } from '../../lib/format';
import { PERMISSION_LABELS } from '../../lib/constants';
import type { Permission, Post, ScopeType } from '../../../domain/types';

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

export function PostsTab() {
  const { data, backend, notify } = useApp();
  const [editing, setEditing] = useState<Post | null | 'new'>(null);

  return (
    <div className="stack">
      <Alert tone="info" title="Posts are configurable.">
        Every approval step refers to a post, not a person. You can add posts above the VC, rename them, and change their
        scope and permissions without touching code.
      </Alert>

      <div className="row">
        <h3 style={{ flex: 1 }}>Posts &amp; permissions</h3>
        <Button size="small" onClick={() => setEditing('new')}>
          <Icon.Plus size={14} /> Add custom post
        </Button>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Post</th><th>Scope</th><th>Rank</th><th>Permissions</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {[...data.posts].sort((a, b) => a.rank - b.rank).map((post) => (
              <tr key={post.code}>
                <td>
                  <div className="cell-title">{post.name}</div>
                  <div className="cell-sub mono">{post.code}{post.is_system ? ' · system' : ''}</div>
                </td>
                <td><Chip tone="info">{humanise(post.scope_type)}</Chip></td>
                <td>{post.rank}</td>
                <td>
                  <div className="row tight">
                    {post.permissions.slice(0, 4).map((p) => (
                      <Chip key={p} tone="neutral">{PERMISSION_LABELS[p]?.label ?? p}</Chip>
                    ))}
                    {post.permissions.length > 4 ? <Chip tone="neutral">+{post.permissions.length - 4}</Chip> : null}
                  </div>
                </td>
                <td><Chip tone={post.active ? 'success' : 'neutral'}>{post.active ? 'Active' : 'Inactive'}</Chip></td>
                <td style={{ textAlign: 'right' }}>
                  <Button size="small" variant="secondary" onClick={() => setEditing(post)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <PostEditor
          post={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify('Post saved.', 'success');
          }}
          onError={(m) => notify(m, 'error')}
          save={(post) => backend.savePost(post)}
        />
      ) : null}
    </div>
  );
}

function PostEditor({
  post,
  onClose,
  onSaved,
  onError,
  save,
}: {
  post?: Post;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
  save: (post: Post) => Post;
}) {
  const [code, setCode] = useState(post?.code ?? '');
  const [name, setName] = useState(post?.name ?? '');
  const [scopeType, setScopeType] = useState<ScopeType>(post?.scope_type ?? 'department');
  const [rank, setRank] = useState(post?.rank ?? 50);
  const [active, setActive] = useState(post?.active ?? true);
  const [permissions, setPermissions] = useState<Permission[]>(post?.permissions ?? ['application.submit', 'application.view', 'application.act', 'document.view']);

  function toggle(p: Permission) {
    setPermissions((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={post ? `Edit ${post.name}` : 'Add a custom post'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              try {
                save({
                  code: code.trim().toUpperCase(),
                  name,
                  scope_type: scopeType,
                  rank: Number(rank),
                  permissions,
                  is_system: post?.is_system ?? false,
                  active,
                  description: post?.description,
                });
                onSaved();
              } catch (err) {
                onError(errorMessage(err));
              }
            }}
          >
            Save post
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Post code" htmlFor="post-code" required hint="Upper case letters, digits or underscores.">
          <TextInput id="post-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={post?.is_system} />
        </Field>
        <Field label="Display name" htmlFor="post-name" required>
          <TextInput id="post-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Scope level" htmlFor="post-scope" hint="The organisational level this post covers.">
          <Select id="post-scope" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)}>
            <option value="university">University</option>
            <option value="faculty">Faculty</option>
            <option value="department">Department</option>
            <option value="batch">Batch</option>
            <option value="section">Section</option>
          </Select>
        </Field>
        <Field label="Seniority rank" htmlFor="post-rank" hint="Higher = more senior. Used only for display order.">
          <TextInput id="post-rank" type="number" value={rank} onChange={(e) => setRank(Number(e.target.value))} />
        </Field>
      </div>

      <fieldset>
        <legend>Permissions</legend>
        <div className="stack sm">
          {ALL_PERMISSIONS.map((p) => (
            <label key={p} className="checkbox">
              <input type="checkbox" checked={permissions.includes(p)} onChange={() => toggle(p)} />
              <span>
                <strong style={{ fontSize: '0.85rem' }}>{PERMISSION_LABELS[p].label}</strong>
                <span className="cell-sub" style={{ display: 'block' }}>{PERMISSION_LABELS[p].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="checkbox">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Post is active and can be assigned</span>
      </label>
    </Modal>
  );
}
