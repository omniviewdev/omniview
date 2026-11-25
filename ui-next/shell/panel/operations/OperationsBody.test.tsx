import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profiler, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActivityFeed, type ActivityRecordLike, type TaskState } from '../activity';
import type { OpenSubject } from '../subject';
import { createOperations } from './model';
import { OperationsBody } from './OperationsBody';
import { names, T0, task, units } from './testing';
import type { CancelFailure } from './types';

// The body of the Operations tool (ch16 S122: "an `H.dataView` over the record store"): the empty words, the table, and the cells of one row, against the real model over the real feed. jsdom lays nothing out, so the table's region
// gets the size a browser would give it (rows are in view) and what is asserted of the layout is what the markup and the stylesheet carry; the measured layout is the probe's.

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

/** The instant the page reads the clock at: 30 seconds after the records of the tests began. */
const NOW = T0 + 30_000;

/** `error` is the sentence of a failed observation of the activity service: what the provider says when it could not read it. */
function mount(records: readonly ActivityRecordLike[] = [], options: { readonly cancel?: (id: string) => Promise<unknown>; readonly strict?: boolean; readonly error?: string } = {}) {
  const cancel = vi.fn<(id: string) => Promise<unknown>>(options.cancel ?? (async () => undefined));
  const markRead = vi.fn<(id: string) => Promise<unknown>>(async () => undefined);
  const control = createActivityFeed({ cancel, markRead });
  const known = names();
  const failures: CancelFailure[] = [];
  const operations = createOperations({
    feed: control.feed,
    resolve: known.resolve,
    fail: (failure) => {
      failures.push(failure);
    },
  });
  operations.attach();
  control.push(records, options.error);
  const read = vi.spyOn(operations, 'markRead');
  const open = vi.fn<OpenSubject>();
  const commits = { count: 0, phases: [] as string[] };
  const tree = (opener: OpenSubject) => (
    <Profiler
      id="operations"
      onRender={(_id, phase) => {
        commits.count += 1;
        commits.phases.push(phase);
      }}
    >
      <OperationsBody operations={operations} open={opener} />
    </Profiler>
  );
  const wrap = (opener: OpenSubject) => (options.strict === true ? <StrictMode>{tree(opener)}</StrictMode> : tree(opener));
  const view = render(wrap(open));
  return {
    ...view,
    operations,
    open,
    cancel,
    feedRead: markRead,
    read,
    known,
    failures,
    commits,
    /** The host draws the tool again, with another function to open with. */
    redraw: (opener: OpenSubject) => {
      view.rerender(wrap(opener));
    },
    user: userEvent.setup(),
    push: (next: readonly ActivityRecordLike[], error?: string) => {
      act(() => {
        control.push(next, error);
      });
    },
  };
}

const COLUMNS = ['operation', 'source', 'target', 'state', 'progress', 'started', 'actions'] as const;
type Column = (typeof COLUMNS)[number];

const region = (): HTMLElement => screen.getByRole('region', { name: 'Operations' });

/** The rows of the body, header left out, as the titles they show. */
const titles = (): Array<string | null | undefined> => within(region()).getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent);

function rowOf(title: string): HTMLTableRowElement {
  const row = screen.getByText(title).closest('tr');
  if (row === null) {
    throw new Error(`no row titled ${title}`);
  }

  return row;
}

function cell(title: string, column: Column): HTMLElement {
  const found = rowOf(title).querySelectorAll('td')[COLUMNS.indexOf(column)];
  if (found === undefined) {
    throw new Error(`the row ${title} has no ${column} cell`);
  }

  return found;
}

/** What the State cell draws: the role the kit's `Status` gives it, the glyph, the word and the tip. */
function stateOf(title: string) {
  const status = cell(title, 'state').querySelector('[data-ov-role]');
  return { role: status?.getAttribute('data-ov-role'), glyph: status?.querySelector('svg')?.getAttribute('data-ov-glyph'), word: status?.textContent, tip: status?.getAttribute('data-ov-tip') };
}

beforeEach(() => {
  // Only the date is faked: the page's age words are read at a known instant and every other timer is the real one.
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('with no operation', () => {
  it('says so in the mock\'s words, and draws no table', () => {
    mount([]);
    const status = screen.getByRole('status');
    expect(within(status).getByText('No operations')).toBeInTheDocument();
    expect(within(status).getByText('Operations you start and background work from plugins appear here.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('draws the tool\'s glyph in the empty state', () => {
    const { container } = mount([]);
    expect(container.querySelector('[data-ov-glyph="activity"]')).not.toBeNull();
  });

  it('is not the empty state when every record is of another kind: an alert is not an operation', () => {
    mount([{ ...task('a1'), kind: 'alert', task: undefined }]);
    expect(screen.getByText('No operations')).toBeInTheDocument();
  });

  it('turns into the table when the first operation arrives, and back when the last one goes', () => {
    const { push } = mount([]);
    expect(screen.getByText('No operations')).toBeInTheDocument();
    push([task('a', { title: 'Reindexing the catalogue' })]);
    expect(screen.queryByText('No operations')).not.toBeInTheDocument();
    expect(screen.getByText('Reindexing the catalogue')).toBeInTheDocument();
    push([]);
    expect(screen.getByText('No operations')).toBeInTheDocument();
  });
});

// A failed observation of the activity service holds no record, as an observation of no activity does: the tool must not say "No operations" for a read that failed. The rows the window already holds stay listed.
describe('when the activity service cannot be observed', () => {
  const SENTENCE = 'The activity service did not answer.';

  it('says so in place of "No operations" when the tool holds no row: its title and the feed\'s sentence, as an alert, and no table', () => {
    mount([], { error: SENTENCE });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Couldn\'t read operations')).toBeInTheDocument();
    expect(within(alert).getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.queryByText('No operations')).not.toBeInTheDocument();
    expect(screen.queryByText('Operations you start and background work from plugins appear here.')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('is not an alert while the service can be observed: the empty state is a status', () => {
    mount([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No operations');
  });

  it('says what the feed says, whatever the sentence is: nothing of it is the tool\'s', () => {
    mount([], { error: 'The host is not running (connection refused).' });
    expect(screen.getByRole('alert')).toHaveTextContent('The host is not running (connection refused).');
  });

  it('comes in place of the empty state when the service fails with no row, and goes back to it when the service can be observed again', () => {
    const { push } = mount([]);
    expect(screen.getByText('No operations')).toBeInTheDocument();
    push([], SENTENCE);
    expect(screen.queryByText('No operations')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(SENTENCE);
    push([]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No operations')).toBeInTheDocument();
  });

  it('keeps the rows listed when the service fails after it worked: a failed read is not the end of what the window saw', () => {
    const records = [task('a', { title: 'Reindexing the catalogue' }), task('b', { title: 'Exporting the report', at: 1, state: 'succeeded' })];
    const { push } = mount(records);
    push(records, SENTENCE);
    expect(titles()).toEqual(['Reindexing the catalogue', 'Exporting the report']);
    expect(screen.getByText('2 operations')).toBeInTheDocument();
    expect(screen.queryByText('No operations')).not.toBeInTheDocument();
  });

  it('lists the rows of a window that mounted after the service failed, when the feed holds some', () => {
    mount([task('a', { title: 'Reindexing the catalogue' })], { error: SENTENCE });
    expect(titles()).toEqual(['Reindexing the catalogue']);
  });

  it('makes no commit for a push that says the same: the sentence is the one it already shows', () => {
    const t = mount([], { error: SENTENCE });
    t.commits.count = 0;
    t.push([], SENTENCE);
    expect(t.commits.count).toBe(0);
  });
});

describe('the table', () => {
  it('is the one region of the tool, named Operations, with the mock\'s columns less the Duration no producer can state', () => {
    mount([task('a')]);
    expect(within(region()).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Operation', 'Source', 'Target', 'State', 'Progress', 'Started', 'Actions']);
    expect(screen.queryByRole('columnheader', { name: 'Duration' })).not.toBeInTheDocument();
  });

  it('has no sort button in a header, no filter, no search and no toolbar: those are later slices', () => {
    mount([task('a'), task('b')]);
    for (const header of within(region()).getAllByRole('columnheader')) {
      expect(header.querySelector('button')).toBeNull();
      expect(header).not.toHaveAttribute('aria-sort');
    }

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /filter|search/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('counts its rows in the footer, in the singular and the plural', () => {
    const { push } = mount([task('a', { title: 'Reindexing the catalogue' })]);
    expect(screen.getByText('1 operation')).toBeInTheDocument();
    push([task('a'), task('b', { at: 1 }), task('c', { at: 2, state: 'failed' })]);
    expect(screen.getByText('3 operations')).toBeInTheDocument();
    expect(screen.queryByText('1 operation')).not.toBeInTheDocument();
  });

  it('lists the rows as the model orders them: active work first, then newest first', () => {
    mount([
      task('old-done', { title: 'Old done', state: 'succeeded', at: 10 }),
      task('new-done', { title: 'New done', state: 'failed', at: 50 }),
      task('old-run', { title: 'Old run', state: 'running', at: 20 }),
      task('new-run', { title: 'New run', state: 'paused', at: 40 }),
    ]);
    expect(titles()).toEqual(['New run', 'Old run', 'New done', 'Old done']);
  });

  it('shows the title, the source\'s name, the connection\'s name, and a dash named No target for work that has none', () => {
    mount([
      task('a', { title: 'Reindexing the catalogue', source: { pluginID: 'alpha', connectionID: 'c-1' }, at: 2 }),
      task('b', { title: 'Syncing the window', source: {}, at: 1 }),
    ]);
    expect(cell('Reindexing the catalogue', 'operation')).toHaveTextContent('Reindexing the catalogue');
    expect(cell('Reindexing the catalogue', 'source')).toHaveTextContent('Alpha Cloud');
    expect(cell('Reindexing the catalogue', 'target')).toHaveTextContent('north');
    expect(cell('Syncing the window', 'source')).toHaveTextContent('Omniview');
    expect(within(cell('Syncing the window', 'target')).getByRole('img', { name: 'No target' })).toBeInTheDocument();
    expect(within(cell('Reindexing the catalogue', 'target')).queryByRole('img')).not.toBeInTheDocument();
  });

  it('marks the words that may be cut for the one tooltip of the window, which says them whole while they are cut', () => {
    mount([task('a', { title: 'Reindexing the catalogue', source: { pluginID: 'alpha', connectionID: 'c-1' } })]);
    for (const [column, words] of [['operation', 'Reindexing the catalogue'], ['source', 'Alpha Cloud'], ['target', 'north']] as const) {
      const clip = cell('Reindexing the catalogue', column).querySelector('[data-ov-clip]');
      expect(clip?.textContent, column).toBe(words);
    }
  });
});

describe('the State column', () => {
  it.each<readonly [TaskState, string, string, string]>([
    ['starting', 'progress', 'clock', 'Starting'],
    ['running', 'progress', 'loader-circle', 'Running'],
    ['paused', 'stopped', 'circle-minus', 'Paused'],
    ['succeeded', 'healthy', 'status-success', 'Succeeded'],
    ['failed', 'error', 'status-error', 'Failed'],
    ['cancelled', 'stopped', 'circle-minus', 'Canceled'],
    ['unknown', 'attention', 'status-warning', 'Outcome unknown'],
  ])('says a task that is %s with the %s role (glyph %s) and the word "%s"', (state, role, glyph, word) => {
    mount([task('a', { title: 'The work', state })]);
    expect(stateOf('The work')).toMatchObject({ role, glyph, word });
  });

  it('draws work that has not started with the clock, not the loader of work that is under way: waiting is not moving (SR1)', () => {
    mount([task('a', { title: 'Waiting', state: 'starting' }), task('b', { title: 'Going', state: 'running', at: 1 })]);
    expect(stateOf('Waiting').glyph).toBe('clock');
    expect(stateOf('Going').glyph).toBe('loader-circle');
  });

  it('says what the producer said of a failure, and of an outcome nobody knows, as the tip of the state: the word is short and the cause is not', () => {
    mount([
      task('a', { title: 'Broken', state: 'failed', message: 'The server did not answer', at: 2 }),
      task('b', { title: 'Lost', state: 'unknown', message: 'Check the catalogue', at: 1 }),
    ]);
    expect(stateOf('Broken').tip).toBe('The server did not answer');
    expect(stateOf('Lost').tip).toBe('Check the catalogue');
  });

  it('gives no tip to a state that has no cause to say: a message of a task that is running or succeeded is the notification centre\'s', () => {
    mount([
      task('a', { title: 'Going', state: 'running', message: 'Scanning', at: 3 }),
      task('b', { title: 'Done', state: 'succeeded', message: 'All 14 files', at: 2 }),
      task('c', { title: 'Broken, no cause', state: 'failed', at: 1 }),
    ]);
    expect(stateOf('Going').tip).toBeNull();
    expect(stateOf('Done').tip).toBeNull();
    expect(stateOf('Broken, no cause').tip).toBeNull();
  });

  it('says Canceling… while a cancel is pending, whatever state the work was in, with the loader: a change is in motion', () => {
    mount([
      task('a', { title: 'Going', cancellation: 'requested', at: 3 }),
      task('b', { title: 'Paused one', state: 'paused', cancellation: 'acknowledged', at: 2 }),
      task('c', { title: 'Waiting', state: 'starting', cancellation: 'requested', at: 1 }),
    ]);
    for (const title of ['Going', 'Paused one', 'Waiting']) {
      expect(stateOf(title), title).toMatchObject({ role: 'progress', glyph: 'loader-circle', word: 'Canceling…' });
    }
  });

  it('says Canceling… for a request of this window that is in flight, and the word of the state again when it failed', async () => {
    const gate = Promise.withResolvers<unknown>();
    const { user, push } = mount([task('a', { title: 'Going', cancellation: 'available' })], { cancel: async () => gate.promise });
    expect(stateOf('Going').word).toBe('Running');
    await user.click(screen.getByRole('button', { name: 'Cancel Going' }));
    expect(stateOf('Going').word).toBe('Canceling…');
    await act(async () => {
      gate.reject(new Error('no'));
      await gate.promise.catch(() => undefined);
    });
    expect(stateOf('Going').word).toBe('Running');
    push([task('a', { title: 'Going', state: 'succeeded' })]);
    expect(stateOf('Going').word).toBe('Succeeded');
  });
});

describe('the Progress column', () => {
  const bar = (title: string): HTMLElement => within(cell(title, 'progress')).getByRole('progressbar', { name: title });

  it('is the producer\'s count: a 4 px bar named for the work, the part that is done, and the producer\'s words beside it', () => {
    mount([task('a', { title: 'Reindexing the catalogue', progress: units('6', '14', 'files') })]);
    expect(bar('Reindexing the catalogue')).toHaveAttribute('aria-valuetext', '6 of 14 files');
    expect(Number(bar('Reindexing the catalogue').getAttribute('aria-valuenow'))).toBeCloseTo(42.8571, 3);
    expect(cell('Reindexing the catalogue', 'progress')).toHaveTextContent('6 of 14 files');
  });

  it('is "2 of 5" for steps, at the part of the bar that is two of five', () => {
    mount([task('a', { title: 'Provisioning', progress: { kind: 'steps', current: '2', total: '5', label: 'Network' } })]);
    expect(bar('Provisioning')).toHaveAttribute('aria-valuenow', '40');
    expect(cell('Provisioning', 'progress')).toHaveTextContent(/^2 of 5$/);
  });

  it('is "40%" for a percent', () => {
    mount([task('a', { title: 'Copying', progress: units('40', '100', '%') })]);
    expect(bar('Copying')).toHaveAttribute('aria-valuenow', '40');
    expect(cell('Copying', 'progress')).toHaveTextContent(/^40%$/);
  });

  it('puts the bar first and the words after it, and marks the words that may be cut', () => {
    mount([task('a', { title: 'Reindexing the catalogue', progress: units('6', '14', 'files') })]);
    const progress = cell('Reindexing the catalogue', 'progress');
    const words = progress.querySelector('[data-ov-clip]');
    expect(words?.textContent).toBe('6 of 14 files');
    expect(bar('Reindexing the catalogue').compareDocumentPosition(words!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is a dash named No progress reported for work that cannot be measured: no bar is made up, and no motion that says nothing', () => {
    mount([task('a', { title: 'Scanning', progress: { kind: 'indeterminate', message: 'Scanning' } })]);
    const progress = cell('Scanning', 'progress');
    expect(within(progress).getByRole('img', { name: 'No progress reported' })).toBeInTheDocument();
    expect(within(progress).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('is the same dash for a task that said nothing, and for one that finished', () => {
    mount([
      task('a', { title: 'Quiet', at: 3 }),
      task('b', { title: 'Done', state: 'succeeded', progress: units('14', '14', 'files'), at: 2 }),
      task('c', { title: 'Broken', state: 'failed', progress: units('6', '14', 'files'), at: 1 }),
    ]);
    for (const title of ['Quiet', 'Done', 'Broken']) {
      expect(within(cell(title, 'progress')).getByRole('img', { name: 'No progress reported' }), title).toBeInTheDocument();
      expect(within(cell(title, 'progress')).queryByRole('progressbar'), title).not.toBeInTheDocument();
    }
  });

  it('says the producer\'s words and draws no bar when its numbers are not a part of a whole', () => {
    mount([task('a', { title: 'Odd', progress: units('3', '0', 'files') })]);
    expect(within(cell('Odd', 'progress')).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(cell('Odd', 'progress')).toHaveTextContent('3 of 0 files');
  });

  it('keeps a count of any size exact: a bar one unit short of its whole is not full', () => {
    mount([task('a', { title: 'Huge', progress: units('999999999999999999999999999999', '1000000000000000000000000000000', 'bytes') })]);
    expect(Number(bar('Huge').getAttribute('aria-valuenow'))).toBeLessThan(100);
  });
});

/** The tip the mock draws for a start (`H.tip(stamp(ms))`, shell-panel.js:133 and 2324): the medium date and the medium time of the machine, in the machine's locale. */
const mockStamp = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

describe('the Started column', () => {
  it('says how long ago the host first had the record, in the mock\'s words and with its rounding, and the instant in the machine\'s own time with the seconds as its tip', () => {
    mount([
      task('a', { title: 'Just started', at: 0 }),
      task('b', { title: 'Older', createdAt: new Date(NOW - 17 * 60_000 - 40_000).toISOString() }),
      task('c', { title: 'Much older', createdAt: new Date(NOW - 5 * 3_600_000).toISOString() }),
      task('d', { title: 'Days old', createdAt: new Date(NOW - 3 * 86_400_000).toISOString() }),
    ]);
    expect(cell('Just started', 'started')).toHaveTextContent(/^just now$/);
    expect(cell('Older', 'started')).toHaveTextContent(/^18 min ago$/);
    expect(cell('Much older', 'started')).toHaveTextContent(/^5 h ago$/);
    expect(cell('Days old', 'started')).toHaveTextContent(/^3 d ago$/);
    expect(cell('Just started', 'started').querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', mockStamp(T0));
    expect(cell('Older', 'started').querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', mockStamp(NOW - 17 * 60_000 - 40_000));
  });

  it('names the instant for assistive technology too: a time element with its machine-readable stamp', () => {
    mount([task('a', { title: 'Just started', at: 0 })]);
    expect(cell('Just started', 'started').querySelector('time')).toHaveAttribute('datetime', '2026-11-24T10:00:00.000Z');
  });

  it('draws a dash named for what is missing when the record\'s time cannot be read, and no time', () => {
    mount([task('a', { title: 'Timeless', createdAt: 'not a time' })]);
    expect(within(cell('Timeless', 'started')).getByRole('img', { name: 'No start time' })).toBeInTheDocument();
    expect(cell('Timeless', 'started').querySelector('time')).toBeNull();
  });

  describe('on the page\'s one age clock', () => {
    beforeEach(() => {
      vi.useRealTimers();
      vi.useFakeTimers({ now: NOW });
    });

    it('turns "just now" into "1 min ago" at the half of the 45th second, the mock\'s rounding, and the tip keeps the stamp it had', () => {
      mount([task('a', { title: 'Just started', at: 0 })]);
      const tipOf = () => cell('Just started', 'started').querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip');
      expect(cell('Just started', 'started')).toHaveTextContent('just now');
      expect(tipOf()).toBe(mockStamp(T0));
      // The record is 30 s old when the page reads the clock: its 44.5th second is 14.5 s on.
      act(() => {
        vi.advanceTimersByTime(14_499);
      });
      expect(cell('Just started', 'started')).toHaveTextContent('just now');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(cell('Just started', 'started')).toHaveTextContent('1 min ago');
      expect(tipOf()).toBe(mockStamp(T0));
    });
  });
});

describe('the actions of a row', () => {
  const cancellable = (over: Parameters<typeof task>[1] = {}) => task('a', { title: 'Reindexing the catalogue', cancellation: 'available', source: { pluginID: 'alpha', connectionID: 'c-1' }, ...over });

  it('are a Cancel and an Open, in that order, each a button named for its action and its object', () => {
    mount([cancellable()]);
    const names = within(rowOf('Reindexing the catalogue')).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Cancel Reindexing the catalogue', 'Open north']);
  });

  it('draw no Cancel for work that cannot be cancelled, and none for work that finished: Cancel is only what the producer offers (S84)', () => {
    mount([task('a', { title: 'Plain', cancellation: 'unsupported', at: 2 }), task('b', { title: 'Done', state: 'succeeded', cancellation: 'available', at: 1 })]);
    expect(screen.queryByRole('button', { name: 'Cancel Plain' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Done' })).not.toBeInTheDocument();
  });

  it('name the thing that Open goes to: the connection when the window knows it, else the plugin, and none for the host\'s own work', () => {
    mount([
      task('a', { title: 'On a connection', source: { pluginID: 'alpha', connectionID: 'c-1' }, at: 3 }),
      task('b', { title: 'On a plugin', source: { pluginID: 'beta' }, at: 2 }),
      task('c', { title: 'Host work', source: {}, at: 1 }),
    ]);
    expect(within(rowOf('On a connection')).getByRole('button', { name: 'Open north' })).toBeInTheDocument();
    expect(within(rowOf('On a plugin')).getByRole('button', { name: 'Open Beta Works' })).toBeInTheDocument();
    expect(within(rowOf('Host work')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('ask the feed to cancel the task when Cancel is pressed, once, and the row says Canceling… with the button still in its place, unavailable and with the reason', async () => {
    const gate = Promise.withResolvers<unknown>();
    const { user, cancel } = mount([cancellable()], { cancel: async () => gate.promise });
    await user.click(screen.getByRole('button', { name: 'Cancel Reindexing the catalogue' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('a');
    const button = screen.getByRole('button', { name: 'Cancel Reindexing the catalogue' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Canceling…');
    await user.click(button);
    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve(undefined);
      await gate.promise;
    });
  });

  it('keep the Cancel of a task whose cancellation the host acknowledged, unavailable, so Open does not move', () => {
    mount([cancellable({ cancellation: 'acknowledged' })]);
    const button = screen.getByRole('button', { name: 'Cancel Reindexing the catalogue' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Canceling…');
    expect(screen.getByRole('button', { name: 'Open north' })).toBeInTheDocument();
  });

  it('are Tab stops, in the order of the row: a row is not one, so the same action is a button in it (A14)', async () => {
    const { user } = mount([cancellable()]);
    const buttons = [screen.getByRole('button', { name: 'Cancel Reindexing the catalogue' }), screen.getByRole('button', { name: 'Open north' })];
    for (const button of buttons) {
      expect(button).not.toHaveAttribute('tabindex', '-1');
    }

    buttons[0]?.focus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
  });

  it('open the subject of the row when Open is pressed, with the click, and open it once: the press is not also the row\'s', async () => {
    const { user, open } = mount([cancellable()]);
    await user.click(screen.getByRole('button', { name: 'Open north' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, expect.objectContaining({ type: 'click' }));
  });

  it('hand the modifiers of the click to the host, which picks the way it opens (a background tab, a new tab)', () => {
    const { open } = mount([cancellable()]);
    fireEvent.click(screen.getByRole('button', { name: 'Open north' }), { metaKey: true });
    expect(open).toHaveBeenCalledWith({ kind: 'connection', plugin: 'alpha', connection: 'c-1' }, expect.objectContaining({ metaKey: true }));
  });

  it('draw Cancel and Open with the glyphs of the mock: a cross, and the arrow out of a box (external-link)', () => {
    mount([cancellable()]);
    const glyphs = within(rowOf('Reindexing the catalogue')).getAllByRole('button').map((button) => button.querySelector('svg')?.getAttribute('data-ov-glyph'));
    expect(glyphs[0]).toBe('close');
    expect(glyphs[1]).toBe('external-link');
  });
});

describe('activating a row', () => {
  it('opens the subject of the row with the click, as the Open button does', () => {
    const { open } = mount([task('a', { title: 'On a plugin', source: { pluginID: 'beta' } })]);
    fireEvent.click(screen.getByText('On a plugin'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ kind: 'plugin', plugin: 'beta' }, expect.objectContaining({ type: 'click' }));
  });

  it('opens it in the way the modifiers of the click say', () => {
    const { open } = mount([task('a', { title: 'On a plugin', source: { pluginID: 'beta' } })]);
    fireEvent.click(screen.getByText('On a plugin'), { shiftKey: true });
    expect(open).toHaveBeenCalledWith({ kind: 'plugin', plugin: 'beta' }, expect.objectContaining({ shiftKey: true }));
  });

  it('does nothing for work that has no page: the host\'s own', () => {
    const { open } = mount([task('a', { title: 'Host work', source: {} })]);
    fireEvent.click(screen.getByText('Host work'));
    expect(open).not.toHaveBeenCalled();
  });

  it('is not what a press of Cancel does', async () => {
    const { user, open } = mount([task('a', { title: 'Going', cancellation: 'available', source: { pluginID: 'beta' } })]);
    await user.click(screen.getByRole('button', { name: 'Cancel Going' }));
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the rows follow the model', () => {
  it('draws a change of one record in its row, and keeps the other rows\' elements', () => {
    const a = task('a', { title: 'First', at: 2, progress: units('1', '4', 'files') });
    const b = task('b', { title: 'Second', at: 1, state: 'succeeded' });
    const { push } = mount([a, b]);
    const second = rowOf('Second');
    push([{ ...a, presentation: { ...a.presentation, progress: units('3', '4', 'files') } }, b]);
    expect(cell('First', 'progress')).toHaveTextContent('3 of 4 files');
    expect(rowOf('Second')).toBe(second);
  });

  it('moves a task that finished below the work that has not, and draws its outcome with the cause as the tip', () => {
    const a = task('a', { title: 'First', at: 2, cancellation: 'available' });
    const b = task('b', { title: 'Second', at: 1 });
    const { push } = mount([a, b]);
    expect(titles()).toEqual(['First', 'Second']);
    push([{ ...a, presentation: { ...a.presentation, message: 'The server did not answer' }, task: { state: 'failed', cancellation: 'unsupported' } }, b]);
    expect(titles()).toEqual(['Second', 'First']);
    expect(stateOf('First')).toMatchObject({ word: 'Failed', tip: 'The server did not answer' });
    expect(screen.queryByRole('button', { name: 'Cancel First' })).not.toBeInTheDocument();
    expect(within(cell('First', 'progress')).getByRole('img', { name: 'No progress reported' })).toBeInTheDocument();
  });

  it('is drawn again when the window learns a name: the plugin\'s id becomes its name once the host says the model changed what it knows', () => {
    const { known, operations } = mount([task('a', { title: 'On gamma', source: { pluginID: 'gamma' } })]);
    expect(cell('On gamma', 'source')).toHaveTextContent('gamma');
    known.plugins.gamma = 'Gamma Labs';
    act(() => {
      operations.refresh();
    });
    expect(cell('On gamma', 'source')).toHaveTextContent('Gamma Labs');
    expect(within(rowOf('On gamma')).getByRole('button', { name: 'Open Gamma Labs' })).toBeInTheDocument();
  });

  it('keeps its rows, with their elements, when the host draws the tool again with another function to open with', () => {
    const { redraw } = mount([task('a', { title: 'First' })]);
    const row = rowOf('First');
    redraw(vi.fn<OpenSubject>());
    expect(rowOf('First')).toBe(row);
  });
});

describe('when 200 rows arrive together', () => {
  const many = (count: number): ActivityRecordLike[] => Array.from({ length: count }, (_, index) => task(`t${String(index).padStart(3, '0')}`, { title: `Work ${String(index)}`, at: index, state: index % 4 === 0 ? 'failed' : 'running', progress: units(String(index), '200', 'files') }));

  it('is the body\'s one commit, and the kit table\'s own first measurement of itself, when the tool was empty', () => {
    const t = mount([]);
    t.commits.count = 0;
    t.commits.phases.length = 0;
    t.push(many(200));
    // A table that mounts measures itself once after it is in the document (a bare kit table mounts in 'mount' and 'nested-update'): the body adds nothing to that, and the 200 rows are in the first commit.
    expect(t.commits.phases).toEqual(['update', 'nested-update']);
    expect(screen.getByText('200 operations')).toBeInTheDocument();
    expect(titles()[0]).toBe('Work 199');
  });

  it('is one commit when the tool had a row, and the rows in view are the newest of them', () => {
    const t = mount([task('first', { title: 'The first one', at: -1000 })]);
    t.commits.count = 0;
    t.push([task('first', { title: 'The first one', at: -1000 }), ...many(200)]);
    expect(t.commits.count).toBe(1);
    expect(screen.getByText('201 operations')).toBeInTheDocument();
    // Active first, newest first: the newest running one is Work 199 (index 199 is not a failure).
    expect(titles()[0]).toBe('Work 199');
  });

  it('is one commit for a change of one record in view, and none are made for a change that says nothing', () => {
    const records = many(200);
    const t = mount(records);
    t.commits.count = 0;
    t.push([...records]);
    expect(t.commits.count).toBe(0);
    const next = [...records];
    next[199] = { ...next[199], presentation: { title: 'Work 199', progress: units('150', '200', 'files') } };
    t.push(next);
    expect(t.commits.count).toBe(1);
  });
});

describe('marking read: what the tool has shown for a second (S81)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
  });

  const advance = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };

  it('marks the unread ones when the tool has been on screen for a second, and not before', () => {
    const { read } = mount([task('a', { state: 'failed', at: 0 }), task('b', { state: 'unknown', at: 1 }), task('c', { state: 'succeeded', at: 2 })]);
    advance(999);
    expect(read).not.toHaveBeenCalled();
    advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(['b', 'a']);
  });

  it('asks the feed for those ids, through the model', () => {
    const { feedRead } = mount([task('a', { state: 'failed', at: 0 }), task('b', { state: 'failed', at: 1 })]);
    advance(1000);
    expect(feedRead.mock.calls).toEqual([['b'], ['a']]);
  });

  it('arms nothing while nothing is unread: running work is never unread, and what finished well needs no look', () => {
    const { read } = mount([task('a', { severity: 'error' }), task('b', { state: 'succeeded', at: 1 }), task('c', { state: 'failed', read: true, at: 2 })]);
    advance(10_000);
    expect(read).not.toHaveBeenCalled();
  });

  it('asks once for the ids it was armed for, and not again while they are the same: the host\'s answer comes back through the feed', () => {
    const { read } = mount([task('a', { state: 'failed' })]);
    advance(10_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not mark anything after the tool left the screen: the host unmounts the body, and the timer goes with it', () => {
    const { read, unmount } = mount([task('a', { state: 'failed' })]);
    advance(500);
    unmount();
    advance(10_000);
    expect(read).not.toHaveBeenCalled();
  });

  // Each failure has ITS OWN second, from the moment the tool listed it: one that arrives later neither starts an older one's second again nor is read before its own is over.
  const marked = (read: { readonly mock: { readonly calls: ReadonlyArray<readonly [readonly string[]]> } }) => read.mock.calls.map(([ids]) => ids);

  it('keeps the second of each failure from when the tool listed it: one that arrives 600 ms later does not start the older one\'s again', () => {
    const a = task('a', { state: 'failed', at: 0 });
    const b = task('b', { state: 'failed', at: 1 });
    const { read, push } = mount([a]);
    advance(600);
    push([a, b]);
    // t = 999: a has been listed for 999 ms, b for 399.
    advance(399);
    expect(read).not.toHaveBeenCalled();
    // t = 1000: a's second is over, and only a is asked for.
    advance(1);
    expect(marked(read)).toEqual([['a']]);
    // t = 1599: b has been listed for 999 ms.
    advance(599);
    expect(marked(read)).toEqual([['a']]);
    // t = 1600: b's second is over.
    advance(1);
    expect(marked(read)).toEqual([['a'], ['b']]);
  });

  it('marks each failure of a stream at its own second when one arrives every 600 ms: none waits for the stream to stop', () => {
    const failure = (index: number) => task(`f${String(index)}`, { state: 'failed', at: index });
    const records = [failure(0)];
    const { read, push } = mount(records);
    // f1 arrives at 600 ms, f2 at 1200, f3 at 1800, f4 at 2400 and f5 at 3000: each one's second ends 1000 ms after it arrived.
    for (let index = 1; index <= 5; index++) {
      advance(600);
      records.push(failure(index));
      push([...records]);
    }

    expect(marked(read)).toEqual([['f0'], ['f1'], ['f2'], ['f3']]);
    advance(400);
    expect(marked(read)).toEqual([['f0'], ['f1'], ['f2'], ['f3'], ['f4']]);
    advance(600);
    expect(marked(read)).toEqual([['f0'], ['f1'], ['f2'], ['f3'], ['f4'], ['f5']]);
  });

  it('asks for an id once while it stays unread: a failure that arrives after its mark was asked for, and before the host answered, does not ask for it again', () => {
    const a = task('a', { state: 'failed', at: 0 });
    const { read, push } = mount([a]);
    advance(1000);
    expect(marked(read)).toEqual([['a']]);
    // The host has not answered: the record is still unread when b arrives.
    push([a, task('b', { state: 'failed', at: 1 })]);
    advance(1000);
    expect(marked(read)).toEqual([['a'], ['b']]);
  });

  it('asks for the failures that arrive together in one call, at their second: 200 of them are one call and not 200', () => {
    const failures = Array.from({ length: 200 }, (_, index) => task(`t${String(index).padStart(3, '0')}`, { state: 'failed', at: index }));
    const { read } = mount(failures);
    advance(999);
    expect(read).not.toHaveBeenCalled();
    advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(marked(read)[0]).toHaveLength(200);
  });

  it('begins a new second for an id that was read from another window and is unread again: the second its first listing had is not the new one\'s', () => {
    const failed = task('a', { state: 'failed' });
    const { read, push } = mount([failed]);
    advance(400);
    push([{ ...failed, visibility: { read: true } }]);
    advance(100);
    push([failed]);
    // t = 1000: the first listing's second is over, and the id is not that listing's any more.
    advance(500);
    expect(read).not.toHaveBeenCalled();
    // t = 1500: the second listing's.
    advance(500);
    expect(marked(read)).toEqual([['a']]);
  });

  it('runs no second after the tool left the screen, whichever failure it was for, and leaves no timer behind: each had its own', () => {
    const a = task('a', { state: 'failed', at: 0 });
    const { read, push, unmount } = mount([a]);
    advance(600);
    push([a, task('b', { state: 'failed', at: 1 })]);
    advance(100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    advance(10_000);
    expect(read).not.toHaveBeenCalled();
  });

  it('stops when what it was armed for is read before the second is over: the host marked it from another window', () => {
    const failed = task('a', { state: 'failed' });
    const { read, push } = mount([failed]);
    advance(600);
    push([{ ...failed, visibility: { read: true } }]);
    advance(10_000);
    expect(read).not.toHaveBeenCalled();
  });

  it('is not asked twice by a body that was mounted twice in a row (a development mount runs its effects twice)', () => {
    const { read } = mount([task('a', { state: 'failed' })], { strict: true });
    advance(1000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('is told of the records that were read, and then arms nothing: the badge went with them', async () => {
    const t = mount([task('a', { state: 'failed' })]);
    advance(1000);
    expect(t.operations.getSnapshot().badge).toBeDefined();
    t.push([task('a', { state: 'failed', read: true })]);
    expect(t.operations.getSnapshot().badge).toBeUndefined();
    advance(10_000);
    expect(t.read).toHaveBeenCalledTimes(1);
  });
});

// jsdom does no layout, so what keeps the Progress cell inside its 144 px (the mock's own overflowed under the next cell) is asserted where it is written: the stylesheet.
describe('the stylesheet of the tool', () => {
  const sheet = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'Operations.module.css'), 'utf8');

  /** The declarations of the rule whose selector is exactly `selector`, as property to value. */
  function rule(selector: string): Readonly<Record<string, string>> {
    const escaped = selector.replaceAll('.', '\\.');
    const found = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(sheet);
    if (found?.[1] === undefined) {
      throw new Error(`Operations.module.css has no rule for ${selector}`);
    }

    const declarations: Record<string, string> = {};
    for (const line of found[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        declarations[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }

    return declarations;
  }

  it('sits in the shell\'s layer, above the kit\'s parts, and writes no colour of its own', () => {
    expect(sheet).toMatch(/^[\s\S]*@layer ov\.shell \{/);
    expect(sheet.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it('gives the bar of the Progress cell 48 px and keeps it from shrinking', () => {
    const declarations = rule('.bar');
    expect(declarations['inline-size']).toBe('48px');
    expect(declarations.flex).toBe('0 0 48px');
  });

  it('clips the words of the Progress cell with an ellipsis inside the cell, which the table does not do for a fixed column', () => {
    expect(rule('.progress')).toMatchObject({ display: 'flex', 'min-inline-size': '0', overflow: 'hidden' });
    expect(rule('.progressText')).toMatchObject({ 'min-inline-size': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('clips the title, the source and the connection with an ellipsis too: a fixed column holds its width and does not cut its text', () => {
    expect(rule('.clip')).toMatchObject({ display: 'block', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('lays the row\'s buttons out in a line, 4 px apart', () => {
    expect(rule('.actions')).toMatchObject({ display: 'flex', 'align-items': 'center', gap: 'var(--ov-spacing-4)' });
  });

  it('fills the room the panel gives the body, as an item of a row that does not grow to its content', () => {
    expect(rule('.operations')).toMatchObject({ flex: '1 1 auto', 'min-inline-size': '0', 'min-block-size': '0' });
  });
});
