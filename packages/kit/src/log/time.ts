// The clock of a line: `HH:MM:SS.mmm`, from the RFC 3339 text the backend sent (the mock's `clock(l.t)`, local time). Read for the rows in the window when
// they render; a line that has no time, or text that is not one, has an empty clock.
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;

const two = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** The clock of `timestamp`, in local time or, with `utc`, in UTC; '' when it is empty or not a time. */
export function formatClock(timestamp: string, { utc = false }: { readonly utc?: boolean } = {}): string {
  const match = RFC3339.exec(timestamp);
  if (match === null) {
    return '';
  }

  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const parts = [Number(month), Number(day), Number(hour), Number(minute), Number(second)] as const;
  if (parts[0] < 1 || parts[0] > 12 || parts[1] < 1 || parts[1] > 31 || parts[2] > 23 || parts[3] > 59 || parts[4] > 59) {
    return '';
  }

  // The first three digits of the fraction are the milliseconds; a shorter one is padded on the right ("5" is 500).
  const millis = Number(((fraction ?? '').slice(0, 3)).padEnd(3, '0'));
  let offset = 0;
  if (zone !== undefined && zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
  }

  const date = new Date(Date.UTC(Number(year), parts[0] - 1, parts[1], parts[2], parts[3], parts[4], millis) - offset);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const h = utc ? date.getUTCHours() : date.getHours();
  const m = utc ? date.getUTCMinutes() : date.getMinutes();
  const s = utc ? date.getUTCSeconds() : date.getSeconds();
  const ms = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
  return `${two(h)}:${two(m)}:${two(s)}.${String(ms).padStart(3, '0')}`;
}
