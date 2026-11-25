import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanelStore } from '../../shell';
import { createActivityFeed, type ActivityRecordLike } from '../../shell/panel/activity';
import { unloadedFailure } from '../loader/failure';
import { acme } from '../testing';
import type { ConnectionsApi } from './connections';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// Choosing a row of the Problems tool through the real window (PT1; CodeRabbit on #706, `panelTools.ts` `subjectOpener`): the host, the shell, the panel, the connection store and its actions, the toast layer and the notices
// model, over an invented plugin (Acme). A row that names a connection keeps its Open button while the window still lists the connection, and the window lists what the host last said: a plugin that stopped since is not ready,
// so the choice ends without a page, and the person is told why instead of being met with a button that does nothing. The table's region gets the size a browser would give it (jsdom lays nothing out).

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });
// jsdom has no canvas: the table measures text with an estimate and says nothing (the kit's own tests stub it the same way).
HTMLCanvasElement.prototype.getContext = () => null;

afterEach(cleanup);

const running: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() };
const stopped: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'failed', failure: unloadedFailure('crashed') };

/** A condition the plugin reports for its connection `north`: it is a row of Problems, about the connection, as long as the window knows the connection. */
const alert: ActivityRecordLike = {
  id: 'a-1',
  kind: 'alert',
  severity: 'warning',
  createdAt: '2026-11-24T10:00:00Z',
  source: { pluginID: 'acme', connectionID: 'c-1' },
  presentation: { title: 'Disk almost full' },
  alert: { key: 'disk', state: 'firing', occurrences: 1 },
  visibility: { read: false },
};

/** A condition of a plugin the window does not have: it was uninstalled or turned off while the record of its alert remained. */
const orphan: ActivityRecordLike = {
  id: 'a-2',
  kind: 'alert',
  severity: 'warning',
  createdAt: '2026-11-24T10:00:00Z',
  source: { pluginID: 'gone' },
  presentation: { title: 'Queue stuck' },
  alert: { key: 'queue', state: 'firing', occurrences: 1 },
  visibility: { read: false },
};

/** The host's connection API: one connection of Acme, `north`, which the host says is connected. */
const api: ConnectionsApi = {
  states: async () => Promise.resolve({ acme: [{ connection: { id: 'c-1', name: 'north' }, readiness: 'CONNECTED' }] }),
  start: async () => Promise.resolve({ status: 'CONNECTED' }),
  onStatus: () => () => undefined,
  onSync: () => () => undefined,
};

function mount() {
  let entries: readonly PluginEntry[] = [running];
  const listeners = new Set<() => void>();
  const plugins = {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const control = createActivityFeed({ cancel: async () => undefined, markRead: async () => undefined });
  render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} panel={createPanelStore()} connections={api} activity={control.feed} />);
  return {
    user: userEvent.setup(),
    /** The activity service says what the plugin reports. */
    report: (...records: readonly ActivityRecordLike[]) => {
      act(() => {
        control.push(records);
      });
    },
    /** The activity service cannot be observed: the provider holds no record, and says why. */
    fail: (sentence: string) => {
      act(() => {
        control.push([], sentence);
      });
    },
    /** The plugin store tells the host that the plugins are now these. */
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}

/** Opens the panel on the Problems tool. */
async function showProblems(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Panel' }));
  await user.click(screen.getByRole('tab', { name: /^Problems/ }));
}

/** The Open button of the row about `north`: the row is about the connection once the window has read it from the host. */
const openNorth = async (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Open north' });

describe('choosing the row of a connection that cannot be opened', () => {
  it('says why when the plugin stopped while the window still lists the connection: an error toast that names the connection, with the host\'s sentence, and no page opens', async () => {
    const { user, report, set } = mount();
    report(alert);
    await showProblems(user);
    const open = await openNorth();
    set([stopped]);
    expect(open).toBeEnabled();

    await user.click(open);

    const toast = await screen.findByRole('alert', { name: 'Error: Couldn\'t open north' });
    expect(within(toast).getByText('This plugin is not available.')).toBeInTheDocument();
    expect(within(toast).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Widgets/ })).toBeNull();
  });

  it('says nothing when the connection opens: the plugin runs, the page opens in a tab, and no toast is made (the control of the one above)', async () => {
    const { user, report } = mount();
    report(alert);
    await showProblems(user);

    await user.click(await openNorth());

    expect(await screen.findByRole('tab', { name: /Widgets/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: /Couldn't open/ })).toBeNull();
  });
});

describe('choosing the row of a plugin that is not there', () => {
  it('says why: the row of its alert keeps its button, and the toast says what the host says of a plugin it does not have, with no Retry and no page', async () => {
    const { user, report } = mount();
    report(orphan);
    await showProblems(user);

    await user.click(await screen.findByRole('button', { name: 'Open gone' }));

    const toast = await screen.findByRole('alert', { name: 'Error: Couldn\'t open gone' });
    expect(within(toast).getByText('This plugin is not installed, or is turned off.')).toBeInTheDocument();
    expect(within(toast).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Widgets/ })).toBeNull();
  });
});

describe('an activity service that cannot be observed', () => {
  it('is a row of the host in the table, told apart from the empty state: its words, its sentence, and a button that says there is no page to open', async () => {
    const { user, fail } = mount();
    fail('The activity service did not answer.');
    await showProblems(user);

    expect(await screen.findByText('Activity isn\'t available')).toBeInTheDocument();
    expect(screen.getByText('The activity service did not answer.')).toBeInTheDocument();
    expect(screen.queryByText('No problems')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Omniview' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('is gone from the table when the provider can observe the service again: nothing is cleared by hand (S74), and the empty state is the empty one', async () => {
    const { user, fail, report } = mount();
    fail('The activity service did not answer.');
    await showProblems(user);
    expect(await screen.findByText('Activity isn\'t available')).toBeInTheDocument();

    report();

    expect(await screen.findByText('No problems')).toBeInTheDocument();
    expect(screen.queryByText('Activity isn\'t available')).toBeNull();
  });
});
