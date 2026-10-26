import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icons';
import { statusTone } from '../lib/format';
import { STATUS_LABEL, type AppStatus } from '../../domain/types';

/* ----------------------------------------------------------------- layout */

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {breadcrumbs?.length ? (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((b, i) => (
              <span key={`${b.label}-${i}`}>
                {b.to ? <a href={`#${b.to}`}>{b.label}</a> : <span aria-current="page">{b.label}</span>}
                {i < breadcrumbs.length - 1 ? <span aria-hidden="true"> / </span> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <h1>{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card-header">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>{title}</h2>
        {subtitle ? <p className="subtitle" style={{ marginTop: 2 }}>{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'success' | 'warn' | 'danger' | 'info';
}) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'warn' ? 'var(--warn)' : tone === 'danger' ? 'var(--danger)' : tone === 'info' ? 'var(--blue)' : undefined;
  return (
    <div className="card stat-card">
      <div className="row" style={{ gap: 10 }}>
        {icon ? <span className="stat-icon">{icon}</span> : null}
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ chips */

export function StatusChip({ status, label }: { status: AppStatus | string; label?: string }) {
  const text =
    label ??
    (STATUS_LABEL[status as AppStatus] ?? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  return (
    <span className={`chip ${statusTone(status)}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

/* ---------------------------------------------------------------- buttons */

export function Button({
  children,
  variant = 'primary',
  size,
  block,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'small';
  block?: boolean;
  loading?: boolean;
}) {
  const cls = [
    'btn',
    variant === 'primary' ? '' : variant,
    size === 'small' ? 'small' : '',
    block ? 'block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" {...rest} className={cls} disabled={rest.disabled || loading}>
      {loading ? <span className="skeleton" style={{ width: 14, height: 14, borderRadius: 4 }} /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
  required,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span> : null}
      </label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error" role="alert">{error}</span> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <input {...rest} aria-invalid={invalid ? 'true' : undefined} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const { invalid, ...rest } = props;
  return <textarea {...rest} aria-invalid={invalid ? 'true' : undefined} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  const { invalid, children, ...rest } = props;
  return (
    <select {...rest} aria-invalid={invalid ? 'true' : undefined}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------- feedback */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon ?? <Icon.File size={22} />}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warn' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const icon =
    tone === 'success' ? <Icon.CheckCircle size={18} /> : tone === 'danger' ? <Icon.XCircle size={18} /> : tone === 'warn' ? <Icon.Alert size={18} /> : <Icon.Info size={18} />;
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span aria-hidden="true" style={{ marginTop: 1 }}>{icon}</span>
      <div>
        {title ? <strong>{title}</strong> : null}
        {title && children ? ' ' : null}
        {children}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loading-block" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 16, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function PermissionDenied({ what = 'this page' }: { what?: string }) {
  return (
    <Card>
      <EmptyState
        icon={<Icon.Lock size={22} />}
        title="You do not have access to this page"
        description={`Your current post and assignments do not include permission to view ${what}. If you believe this is wrong, contact the university administrator.`}
        action={
          <Button variant="secondary" onClick={() => { window.location.hash = '#/'; }}>
            Back to dashboard
          </Button>
        }
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            <Icon.Close size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === 'number' ? <span style={{ marginLeft: 6, color: 'var(--muted)' }}>({t.count})</span> : null}
        </button>
      ))}
    </div>
  );
}

export function BarRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone?: 'success' | 'warn' | 'danger';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${tone ?? ''}`} style={{ width: `${pct}%`, display: 'block' }} />
      </span>
      <span className="bar-value">{value}</span>
    </div>
  );
}

export function Descriptions({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.label} style={{ display: 'contents' }}>
          <dt>{i.label}</dt>
          <dd>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyButton({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          window.prompt('Copy this link', value);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon.Copy size={14} /> {copied ? 'Copied' : label}
    </Button>
  );
}
