import { describe, expect, it, vi } from 'vitest';
import { createNoticesStore } from '../core/notices';
import type { ActionFailure } from './core/model';
import { describeFailure, reportFailure } from './failureReport';

// What the person is told when the host did not do what the page asked of a plugin (ch16 S75, S77, S135: the cause in the user's terms, sticky, with a Retry). The words are the host's own and are chosen by the CLASS of the
// error (its `type`), never by its text: a lifecycle call fails with the host's own error, whose detail holds paths, the process's own lines and the plugin's, and no gate cleans it (docs/ui-next/status/PL1.md, PLB-04), so none
// of it is drawn.

/** What Wails gives the page: an error whose message is the host's envelope as JSON. */
const wails = (type: string, status: number, detail: string): Error => Object.assign(new Error(JSON.stringify({ type, title: 'Failed to do it', status, detail })), { cause: { type, status, detail } });
const POISON = 'plugin start: exec /Users/me/.omniview/plugins/alpha/bin/alpha: token=abcdef0123456789abcdef0123456789 exited';

describe('describeFailure', () => {
  it.each([
    ['reload', 'Couldn\'t reload Alpha Metrics'],
    ['retry', 'Couldn\'t restart Alpha Metrics'],
    ['enable', 'Couldn\'t enable Alpha Metrics'],
    ['disable', 'Couldn\'t disable Alpha Metrics'],
    ['uninstall', 'Couldn\'t uninstall Alpha Metrics'],
  ] as const)('says what failed, with the plugin\'s name: %s', (operation, title) => {
    expect(describeFailure(operation, 'Alpha Metrics', wails('omniview:internal', 500, 'x'))?.title).toBe(title);
  });

  it.each([
    ['omniview:plugin/not-found', 404, 'It is no longer installed.'],
    ['omniview:plugin/not-loaded', 404, 'It isn\'t loaded right now.'],
    ['omniview:plugin/load-failed', 500, 'The host couldn\'t stop it or start it.'],
    ['omniview:plugin/build-failed', 500, 'Its development build failed.'],
    ['omniview:validation', 409, 'The host won\'t do that to this plugin.'],
    ['omniview:internal', 500, 'The host couldn\'t finish it. Try again.'],
    ['omniview:something-new', 500, 'The host couldn\'t finish it. Try again.'],
  ])('chooses the sentence by the class of the error: %s', (type, status, sentence) => {
    expect(describeFailure('reload', 'Alpha Metrics', wails(type, status, POISON))?.detail).toBe(sentence);
  });

  it('says an uninstall that failed may have left files, and what to do: the host keeps the plugin listed and finishes it when it is uninstalled again', () => {
    expect(describeFailure('uninstall', 'Alpha Metrics', wails('omniview:internal', 500, POISON))?.detail).toBe('Some of its files may be left. It is still listed: uninstall it again to finish.');
  });

  it('is the generic sentence for an error that is not the host\'s envelope, a plain Go error or anything else', () => {
    expect(describeFailure('reload', 'Alpha Metrics', new Error(POISON))?.detail).toBe('The host couldn\'t finish it. Try again.');
    expect(describeFailure('reload', 'Alpha Metrics', POISON)?.detail).toBe('The host couldn\'t finish it. Try again.');
    expect(describeFailure('reload', 'Alpha Metrics', undefined)?.detail).toBe('The host couldn\'t finish it. Try again.');
  });

  it('never carries a word of the error: not its detail, not its title, not its message', () => {
    for (const error of [wails('omniview:internal', 500, POISON), wails('omniview:plugin/load-failed', 500, POISON), new Error(POISON)]) {
      expect(JSON.stringify(describeFailure('uninstall', 'Alpha Metrics', error))).not.toMatch(/Users|token|exec|exited|Failed to do it/);
    }
  });

  it('says nothing of a cancellation: the person asked for it', () => {
    expect(describeFailure('reload', 'Alpha Metrics', wails('omniview:cancelled', 499, 'The operation was cancelled.'))).toBeUndefined();
  });
});

describe('reportFailure', () => {
  const failure = (retry: () => void, error: unknown = wails('omniview:plugin/load-failed', 500, POISON)): ActionFailure => ({ operation: 'reload', id: 'alpha', name: 'Alpha Metrics', error, retry });

  it('is a sticky error toast of the host with a Retry, in the host\'s words', () => {
    const store = createNoticesStore({});

    reportFailure(store, failure(vi.fn()));

    const [toast] = store.getSnapshot().toasts.items;
    expect(toast?.record).toMatchObject({ severity: 'error', title: 'Couldn\'t reload Alpha Metrics', source: 'host', initiator: 'user' });
    expect(toast?.record?.text).toBe('The host couldn\'t stop it or start it.');
    expect(toast?.sticky).toBe(true);
    expect(toast?.record?.actions.map((action) => [action.label, action.icon])).toEqual([['Retry', 'rotate-cw']]);
  });

  it('runs the same call again when the person presses Retry', () => {
    const store = createNoticesStore({});
    const retry = vi.fn();
    reportFailure(store, failure(retry));
    const record = store.getSnapshot().toasts.items[0]?.record;

    store.run(record?.id ?? '', 'again');

    expect(retry).toHaveBeenCalledOnce();
  });

  it('leaves no word of the error anywhere in the model: not in the toast, not in the history, not in the diagnostics', () => {
    const store = createNoticesStore({});

    reportFailure(store, failure(vi.fn()));

    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/Users|token|exec|exited/);
  });

  it('makes no toast for a cancellation, and reports no failure on the console: a cancellation is not a failure', () => {
    const report = vi.spyOn(console, 'error');
    const store = createNoticesStore({});

    reportFailure(store, failure(vi.fn(), wails('omniview:cancelled', 499, 'cancelled')));

    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(report).not.toHaveBeenCalled();
    report.mockRestore();
  });
});
