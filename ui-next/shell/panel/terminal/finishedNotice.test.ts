import type { NoticesStore } from '../../core/notices';
import { describe, expect, it, vi } from 'vitest';
import { makeNotices } from '../../core/notices/testing';
import type { TerminalFinished } from './feed';
import { createFinishedNotices, LONG_COMMAND_MS } from './finishedNotice';

// THE "COMMAND FINISHED" NOTICE (issue #694 step 6). Through the shell's notices; only for a command that ran long by the PRODUCER's duration, in a terminal that is not in front of the person; once for each command; and its action brings
// the terminal forward and jumps to the command. The shell's own notices do the rest (the toast, the bell, the rate limit).

type Rig = {
  readonly fixture: ReturnType<typeof makeNotices>;
  readonly show: ReturnType<typeof vi.fn<(session: string, command: string, generation: number) => void>>;
  readonly front: Set<string>;
  readonly finished: (session: string, finished: Partial<TerminalFinished> & { readonly id: string }, generation?: number) => void;
  readonly records: () => ReturnType<ReturnType<typeof makeNotices>['store']['selectors']['recent']>;
};

function rig(): Rig {
  const fixture = makeNotices();
  const show = vi.fn<(session: string, command: string, generation: number) => void>();
  const front = new Set<string>();
  const notices = createFinishedNotices({ notices: fixture.store, shown: (session) => front.has(session), show, nameOf: (session) => (session === 's1' ? 'zsh' : session === 's2' ? 'zsh (2)' : undefined) });
  return { fixture, show, front, finished: notices.finished, records: () => fixture.store.selectors.recent() };
}

describe('the notice of a command that finished', () => {
  it('is raised for a command that ran long in a terminal that is not in front, with the command, how it ended and how long it took', () => {
    const r = rig();
    r.finished('s1', { id: 'c1', exit: 0, durationMs: 12_000, command: 'make test', timeMs: 5 });
    const [record, ...rest] = r.records();
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ source: 'host', severity: 'success', title: 'Command finished in zsh', text: 'make test · took 12 s' });
    expect(record?.actions.map((action) => action.label)).toEqual(['Show']);
    expect(record?.actions[0]?.variant).toBe('primary');
  });

  it('says a failure as a failure, with the exit status, as a warning', () => {
    const r = rig();
    r.finished('s2', { id: 'c4', exit: 2, durationMs: 90_000, command: 'cargo build', timeMs: 5 });
    expect(r.records()[0]).toMatchObject({ severity: 'warning', title: 'Command failed in zsh (2)', text: 'cargo build · exit 2 · took 1 min 30 s' });
  });

  it('says what it can when the shell did not prove the line or give a status, and names a terminal it cannot name', () => {
    const r = rig();
    r.finished('other', { id: 'c1', durationMs: 20_000, timeMs: 5 });
    expect(r.records()[0]).toMatchObject({ severity: 'success', title: 'Command finished in a terminal', text: 'took 20 s' });
  });

  it('is raised from the threshold up by the producer\'s duration, and for none that is shorter or that the producer did not time', () => {
    const r = rig();
    r.finished('s1', { id: 'c1', durationMs: LONG_COMMAND_MS - 1, timeMs: 1 });
    r.finished('s1', { id: 'c2', timeMs: 2 });
    r.finished('s1', { id: 'c3', durationMs: Number.NaN, timeMs: 3 });
    r.finished('s1', { id: 'c4', durationMs: -5, timeMs: 4 });
    expect(r.records(), 'below the threshold, no duration, not a number, negative').toHaveLength(0);
    r.finished('s1', { id: 'c5', durationMs: LONG_COMMAND_MS, timeMs: 5 });
    expect(r.records(), 'the threshold itself').toHaveLength(1);
    expect(LONG_COMMAND_MS).toBe(10_000);
  });

  it('is not raised for a terminal the person is looking at, however long the command ran, and is when they look away', () => {
    const r = rig();
    r.front.add('s1');
    r.finished('s1', { id: 'c1', durationMs: 600_000, timeMs: 1 });
    expect(r.records()).toHaveLength(0);
    r.front.delete('s1');
    r.finished('s1', { id: 'c2', durationMs: 600_000, timeMs: 2 });
    expect(r.records()).toHaveLength(1);
  });

  it('is raised once for each command: the same command told again is no second notice, another command or the same id of a later shell is', () => {
    const r = rig();
    r.finished('s1', { id: 'c1', durationMs: 20_000, timeMs: 100 });
    r.finished('s1', { id: 'c1', durationMs: 20_000, timeMs: 100 });
    expect(r.records(), 'the same command twice').toHaveLength(1);
    expect(r.records()[0]?.count, 'and the shell\'s notices were told once, not twice and folded').toBe(1);
    r.finished('s2', { id: 'c1', durationMs: 20_000, timeMs: 100 });
    expect(r.records(), 'the same id in another terminal').toHaveLength(2);
    r.finished('s1', { id: 'c1', durationMs: 25_000, timeMs: 900_000 });
    expect(r.records(), 'a restarted shell counts from c1 again, at another time').toHaveLength(3);
  });

  it('leaves a repeat of the same words to the shell\'s notices, which fold it into one record with a count, and the action then goes to the newest command', () => {
    const r = rig();
    r.finished('s1', { id: 'c1', durationMs: 20_000, command: 'make test', timeMs: 100 });
    r.finished('s1', { id: 'c2', durationMs: 20_000, command: 'make test', timeMs: 200 });
    const records = r.records();
    expect(records).toHaveLength(1);
    expect(records[0]?.count).toBe(2);
    r.fixture.store.run(records[0]?.id ?? '', 'show');
    expect(r.show).toHaveBeenCalledWith('s1', 'c2', 0);
  });

  it('keeps no more than it must of what it has told: a flood of commands is bounded, and the newest is still not told twice', () => {
    const r = rig();
    for (let index = 0; index < 1000; index += 1) {
      r.finished('s1', { id: `c${String(index)}`, durationMs: 20_000, timeMs: index });
    }

    // The shell's notices rate limit a source (5 a second, 20 a minute): what is over goes to one row. The bound here is that the newest command, told again, makes nothing more.
    const before = r.fixture.store.stats();
    r.finished('s1', { id: 'c999', durationMs: 20_000, timeMs: 999 });
    expect(r.fixture.store.stats().snapshots, 'a command told again changes nothing').toBe(before.snapshots);
    expect(r.records().length, 'something was raised for the flood').toBeGreaterThan(0);
  });

  it('brings the terminal forward and jumps to the command when its action is pressed', () => {
    const r = rig();
    r.finished('s1', { id: 'c7', durationMs: 20_000, command: 'sleep 20', timeMs: 5 });
    const record = r.records()[0];
    expect(r.fixture.store.run(record?.id ?? '', 'show').status).toBe('done');
    expect(r.show).toHaveBeenCalledTimes(1);
    expect(r.show).toHaveBeenCalledWith('s1', 'c7', 0);
  });

  it('tells the terminal of the session the command finished in to Show, and tells a command of another terminal of the session apart', () => {
    const r = rig();
    r.finished('s1', { id: 'c1', durationMs: 20_000, command: 'make a', timeMs: 100 }, 0);
    r.finished('s1', { id: 'c1', durationMs: 20_000, command: 'make a', timeMs: 100 }, 1);
    expect(r.records()[0]?.count, 'the same id and time in the next terminal of the session is another command').toBe(2);
    r.fixture.store.run(r.records()[0]?.id ?? '', 'show');
    expect(r.show).toHaveBeenCalledWith('s1', 'c1', 1);
  });

  it('bounds the words and keeps a command line\'s control characters out of them: it is the person\'s text, drawn as text (the notice is checked as it is handed to the shell\'s notices, which clean text themselves)', () => {
    const notify = vi.fn<(spec: { readonly title: string; readonly detail?: string | undefined }) => unknown>();
    const sink: Pick<NoticesStore, 'notify'> = { notify: (spec) => (notify(spec), { id: '', refused: undefined } as unknown as ReturnType<NoticesStore['notify']>) };
    const notices = createFinishedNotices({ notices: sink, shown: () => false, show: () => undefined, nameOf: () => 'zsh' });
    notices.finished('s1', { id: 'c1', durationMs: 20_000, command: `echo \u001b[31m${'x'.repeat(500)}\nrm -rf /`, timeMs: 1 });
    const spec = notify.mock.calls[0]?.[0];
    expect(spec, 'a notice was raised').toBeDefined();
    expect(spec?.title.length).toBeLessThanOrEqual(80);
    expect(spec?.detail?.length).toBeLessThanOrEqual(120);
     
    expect(spec?.detail).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(spec?.detail?.startsWith('echo ')).toBe(true);
    expect(spec?.detail?.endsWith('took 20 s')).toBe(true);
  });
});
