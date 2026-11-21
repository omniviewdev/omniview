import type { Muted, RecordView } from '../core/notices';

// The list of the notification centre, from the model's history (ch16 S80; the mock's `centerModel`, `listHtml` and `sourcesOf`, shell-feedback.js): the records the source filter leaves, the first fifty of them
// until the person asks for the rest (`SHOW`, so that a history of hundreds is not drawn to be looked at for a second), and the headings between them: Recent, then a heading for each day, newest first. The model
// gives the order (`recent`: finished records and messages, newest first); this groups and cuts, and decides nothing about a record. Pure: it reads no clock. A day is the viewer's LOCAL day, and the words of a day's
// heading (Today, Yesterday, the date) depend on what time it is, so the list holds the day and not the words: they are made when they are drawn (`dayLabel`) and kept current by the age clock (`dayAge`).

/** The records drawn before "Show N older" (the mock's `SHOW`). */
export const SHOWN = 50;

/**
 * A heading of the list (`label`: Recent), the heading of a day (`day`: the first instant of that local day, whose words are the age of the day) or one of its rows. A heading is an item of the list that takes no row
 * from the keyboard.
 */
export type Item =
  | { readonly kind: 'label'; readonly key: string; readonly text: string }
  | { readonly kind: 'day'; readonly key: string; readonly day: number }
  | { readonly kind: 'row'; readonly record: RecordView };

export type CentreList = {
  /** What the source filter leaves, in the model's order. */
  readonly matched: readonly RecordView[];
  /** What is drawn of it: the first `SHOWN`, or all of it once asked. */
  readonly shown: readonly RecordView[];
  /** How many matched records are not drawn. */
  readonly older: number;
  /** The headings and the rows of `shown`, in order. */
  readonly items: readonly Item[];
};

export type ListOptions = {
  /** The source whose records are listed; empty lists every source. */
  readonly source: string;
  /** Draw every matched record, not the first `SHOWN`. */
  readonly more: boolean;
};

export type SourceChoice = { readonly id: string; readonly label: string };

const dayKey = (time: number): string => {
  const date = new Date(time);
  return `${String(date.getFullYear())}-${String(date.getMonth())}-${String(date.getDate())}`;
};

/**
 * The first instant of the local day `time` is in: its midnight, or the first moment after it where a clock change took the midnight away (Havana, Beirut and Cairo put the clocks forward at 00:00). A day is the date of the
 * viewer's calendar and not 24 hours: it is 23 hours long when the clocks go forward and 25 when they go back.
 */
export function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The first instant of the local day after the one `time` is in: the instant at which a heading that said Today says Yesterday. */
export function startOfNextDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** Today, Yesterday, or the weekday, month and day in the viewer's locale: by the date, not by 24 hours (the mock's `dayLabel`). */
export function dayLabel(time: number, now: number): string {
  const date = new Date(time);
  const today = new Date(now);
  const before = new Date(now);
  before.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return 'Today';
  }

  return date.toDateString() === before.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The words of a day's heading as a label rule for the page's age clock (it has the shape of the kit's `AgeFormatter`, which the kit does not export, as `tipAge`'s has): `dayLabel` of the day at `now`, and the next local
 * midnight as the instant they may change. A heading is the age of its day, so it is right at midnight without anything redrawing the list: the mock reads the clock when it draws the list (shell-feedback.js:657-660) and has
 * no timer for midnight, so a centre left open across it shows the old words until something else draws it.
 */
export function dayAge(date: Date, now: number): { readonly text: string; readonly changesAt: number } {
  return { text: dayLabel(date.getTime(), now), changesAt: startOfNextDay(now) };
}

/** The time a record is listed under, and shows: when it ended, else when it was posted. */
export const timeOf = (record: Pick<RecordView, 'finishedAt' | 'createdAt'>): number => record.finishedAt ?? record.createdAt;

export function listOf(recent: readonly RecordView[], { source, more }: ListOptions): CentreList {
  const matched = source === '' ? recent : recent.filter((record) => record.source === source);
  const shown = more ? matched : matched.slice(0, SHOWN);
  const items: Item[] = [];
  let day = '';
  for (const record of shown) {
    const time = timeOf(record);
    const key = dayKey(time);
    if (key !== day) {
      if (day === '') {
        items.push({ kind: 'label', key: 'label:recent', text: 'Recent' });
      }

      items.push({ kind: 'day', key: `label:day:${key}`, day: startOfDay(time) });
      day = key;
    }

    items.push({ kind: 'row', record });
  }

  return { matched, shown, older: matched.length - shown.length, items };
}

/**
 * The choices of the Filter menu's Source group (the mock's `sourcesOf`): every source that has a record, by name, with how many; the chosen one stays in the list with none when its records are gone, so the filter can
 * still be read and cleared. A source with no record to name it is listed by its id.
 */
export function sourcesOf(recent: readonly RecordView[], selected: string): readonly SourceChoice[] {
  const found = new Map<string, { name: string; count: number }>();
  for (const record of recent) {
    const entry = found.get(record.source);
    if (entry === undefined) {
      found.set(record.source, { name: record.sourceName, count: 1 });
    } else {
      entry.count += 1;
    }
  }

  if (selected !== '' && !found.has(selected)) {
    found.set(selected, { name: selected, count: 0 });
  }

  const sources = [...found.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([id, { name, count }]) => ({ id, label: `${name} (${String(count)})` }));
  return [{ id: '', label: 'All sources' }, ...sources];
}

/** What a source is called: the name its records carry, else the name its mute carries, else its id (a source that has neither a record nor a mute is a filter that nothing is left to name). */
export function nameOfSource(recent: readonly RecordView[], muted: readonly Muted[], id: string): string {
  return recent.find((record) => record.source === id)?.sourceName ?? muted.find((entry) => entry.source === id)?.name ?? id;
}
