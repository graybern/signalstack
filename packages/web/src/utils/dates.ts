let _userTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function setUserTimezone(tz: string) {
  _userTimezone = tz;
}

export function getUserTimezone(): string {
  return _userTimezone;
}

function parseUTC(dateStr: string): Date {
  let s = dateStr.trim();
  if (!s.includes('T')) s = s.replace(' ', 'T');
  if (!s.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(s)) s += 'Z';
  return new Date(s);
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleString(undefined, { timeZone: _userTimezone });
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleDateString(undefined, { timeZone: _userTimezone });
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleTimeString(undefined, { timeZone: _userTimezone });
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleDateString(undefined, {
    timeZone: _userTimezone,
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTimeFull(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleString(undefined, {
    timeZone: _userTimezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDateTimeWithWeekday(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return parseUTC(dateStr).toLocaleDateString(undefined, {
    timeZone: _userTimezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseUTC(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}
