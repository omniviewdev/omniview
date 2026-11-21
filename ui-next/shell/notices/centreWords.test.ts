import { describe, expect, it } from 'vitest';
import type { Muted } from '../core/notices';
import { clockOf, emptyOf, mutedNote, olderLabel, plural, said, tipAge, undoLabel } from './centreWords';

// The words of the notification centre that are its own (ch16 S80, S81; the mock's `EMPTY`, `emptyHtml`, `barHtml`, `commands`, shell-feedback.js). The words of a record are the model's.

describe('plural', () => {
  it('counts with the noun in its right number', () => {
    expect(plural(0, 'notification')).toBe('0 notifications');
    expect(plural(1, 'notification')).toBe('1 notification');
    expect(plural(2, 'notification')).toBe('2 notifications');
  });
});

describe('clockOf', () => {
  it('is the time of day in the viewer\'s locale: hour and minute, no seconds', () => {
    const time = new Date(2026, 10, 21, 15, 5).getTime();
    expect(clockOf(time)).toBe(new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  });
});

describe('tipAge', () => {
  const START = Date.UTC(2023, 10, 14, 22, 13, 20);

  it('is the kit\'s tip: the instant in UTC and the span in words', () => {
    expect(tipAge(new Date(START), START + 5 * 60_000).text).toBe('2023-11-14 22:13 UTC · 5 minutes ago');
    expect(tipAge(new Date(START), START + 30_000).text).toBe('2023-11-14 22:13 UTC · just now');
  });

  it('is asked again at the next minute after the time, which is when its words can change', () => {
    expect(tipAge(new Date(START), START + 30_000).changesAt).toBe(START + 60_000);
    expect(tipAge(new Date(START), START + 60_000).changesAt).toBe(START + 120_000);
    expect(tipAge(new Date(START), START + 5 * 60_000 + 59_999).changesAt).toBe(START + 6 * 60_000);
    expect(tipAge(new Date(START), START + 3 * 86_400_000).changesAt).toBeGreaterThan(START + 3 * 86_400_000);
  });

  it('never names a time that is not after now, whatever the clock says of a time in the future', () => {
    expect(tipAge(new Date(START + 10 * 60_000), START).changesAt).toBeGreaterThan(START);
  });
});

describe('emptyOf', () => {
  it('says nothing for a list that has rows', () => {
    expect(emptyOf({ total: 3, matched: 2, undo: undefined })).toBeUndefined();
  });

  it('says no notifications, and where they come from, for an empty history', () => {
    expect(emptyOf({ total: 0, matched: 0, undo: undefined })).toEqual({
      icon: 'bell-off',
      title: 'No notifications',
      hint: 'Messages from plugins and operations you start appear here.',
      action: undefined,
    });
  });

  it('says what was cleared and for how long it can be brought back, while Undo is offered', () => {
    expect(emptyOf({ total: 0, matched: 0, undo: { count: 3 } })).toEqual({ icon: 'trash', title: 'Cleared 3 notifications', hint: 'Undo brings them back for 10 seconds.', action: undefined });
    expect(emptyOf({ total: 0, matched: 0, undo: { count: 1 } })?.title).toBe('Cleared 1 notification');
  });

  it('says that nothing matches the source, with the one button that leads out, when the history is not empty but the filter leaves nothing', () => {
    expect(emptyOf({ total: 4, matched: 0, undo: undefined })).toEqual({
      icon: 'list-filter',
      title: 'No matching notifications',
      hint: 'Nothing matches the source you chose.',
      action: 'clear-filters',
    });
  });

  it('prefers the filter\'s words to Undo\'s while the history still has records', () => {
    expect(emptyOf({ total: 2, matched: 0, undo: { count: 1 } })?.title).toBe('No matching notifications');
  });
});

describe('mutedNote', () => {
  const at = new Date(2026, 10, 21, 15, 5).getTime();
  const one: Muted = { source: 'cloud', name: 'Cloud', until: at };

  it('has no note when no source is muted', () => {
    expect(mutedNote([])).toBeUndefined();
  });

  it('names the one source and when its mute ends, with an Unmute', () => {
    expect(mutedNote([one])).toEqual({ text: `Cloud is muted until ${clockOf(at)}`, button: 'Unmute' });
  });

  it('says a mute that does not end without a time', () => {
    expect(mutedNote([{ source: 'cloud', name: 'Cloud', until: 'forever' }])).toEqual({ text: 'Cloud is muted', button: 'Unmute' });
  });

  it('counts several sources, with an Unmute all', () => {
    expect(mutedNote([one, { source: 'stack', name: 'Stack', until: at + 1000 }])).toEqual({ text: '2 sources are muted', button: 'Unmute all' });
  });
});

describe('the buttons and announcements', () => {
  it('labels Undo by what it undoes', () => {
    expect(undoLabel(1)).toBe('Undo dismiss');
    expect(undoLabel(2)).toBe('Undo clear');
    expect(undoLabel(40)).toBe('Undo clear');
  });

  it('says how many older records Show reveals', () => {
    expect(olderLabel(450)).toBe('Show 450 older');
    expect(olderLabel(1)).toBe('Show 1 older');
  });

  it('tells a screen reader what an action did, in the mock\'s words', () => {
    expect(said.readAll(3)).toBe('3 notifications marked as read');
    expect(said.readAll(1)).toBe('1 notification marked as read');
    expect(said.cleared(2)).toBe('Cleared 2 notifications. Undo is available for 10 seconds');
    expect(said.restored).toBe('Notifications restored');
    expect(said.muted('Cloud')).toBe('Cloud is muted for 1 hour. Its notifications still arrive here, without toasts');
    expect(said.unmuted('Cloud')).toBe('Cloud is unmuted');
    expect(said.unmutedAll).toBe('Notifications are unmuted');
  });
});
