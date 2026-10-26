import { format, formatDistanceToNowStrict, isValid, parseISO } from './date';

/** Safe date parsing: accepts ISO strings, dates, null. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : parseISO(value);
  return isValid(d) ? d : null;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy') : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, 'dd MMM yyyy, HH:mm') : '—';
}

export function formatTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, 'HH:mm') : '—';
}

export function fromNow(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  try {
    return formatDistanceToNowStrict(d);
  } catch {
    return formatDate(d);
  }
}

export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initialLetters(name: string): string {
  const parts = name.replace(/^(Dr|Prof|Mr|Ms|Mrs|Sri|Smt)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function statusTone(status: string): 'success' | 'warn' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'completed':
    case 'approved':
    case 'published':
    case 'executed':
    case 'active':
      return 'success';
    case 'further_pending':
    case 'returned':
    case 'scheduled':
    case 'awaiting_approval':
    case 'proposed':
      return 'warn';
    case 'rejected':
    case 'suspended':
    case 'expired':
    case 'deletion_scheduled':
      return 'danger';
    case 'submitted':
    case 'under_review':
    case 'resubmitted':
    case 'draft':
      return 'info';
    default:
      return 'neutral';
  }
}

export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function bytes(size: number): string {
  if (!size) return '0 KB';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function days(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—';
  if (n < 1) {
    const hours = Math.max(1, Math.round(n * 24));
    return `${hours} h`;
  }
  return `${n.toFixed(1)} d`;
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]): void {
  const content = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function plural(count: number, singular: string, pluralWord?: string): string {
  return `${count} ${count === 1 ? singular : pluralWord ?? `${singular}s`}`;
}
