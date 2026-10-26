/** Tiny date helpers — avoids a third-party date library in the bundle. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function parseISO(value: string): Date {
  // Date-only strings are treated as UTC midnight; full timestamps parse directly.
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T00:00:00`);
  return new Date(trimmed);
}

export function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Supports the tokens used in this app: yyyy, MMMM, MMM, MM, dd, d, HH, mm, ss.
 */
export function format(date: Date, pattern: string): string {
  if (!isValid(date)) return '—';
  const map: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MMMM: MONTHS_LONG[date.getMonth()],
    MMM: MONTHS[date.getMonth()],
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    d: String(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|d|HH|mm|ss/g, (token) => map[token] ?? token);
}

export function formatDistanceToNowStrict(date: Date, now = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const seconds = Math.round(Math.abs(diffMs) / 1000);
  const units: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ];
  let value = seconds;
  let unit = 'second';
  for (const [size, name] of units) {
    unit = name;
    if (value < size) break;
    value = value / size;
  }
  const rounded = Math.round(value);
  const label = `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
  return future ? `in ${label}` : `${label} ago`;
}
