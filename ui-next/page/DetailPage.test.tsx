import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailPageDefinition, DetailSource, DetailState, DetailView } from './detailDefinition';
import { DetailPage } from './DetailPage';
import { FELT_MS, REFRESH_LIMIT_MS } from './useRefreshFeedback';

// The page is plugin-agnostic, so the tests are too: an invented widget in an invented bay. What is under test is what the page does with a source that says a read failed while the
// object is on screen: it keeps the object, and says so where the page's other acknowledgements go, the header's operation slot.

const definition: DetailPageDefinition = {
  kind: 'Widget',
  tile: { icon: 'box' },
  identity: { name: 'name' },
  tabs: [{ id: 'overview', label: 'Overview' }],
};

const params = { name: 'lathe-4' };

const view: DetailView = {
  state: { role: 'running', label: 'Running' },
  tabs: { overview: { kind: 'overview', sections: [{ id: 'details', kind: 'kv', title: 'Details', rows: [{ label: 'Bay', value: 'north' }] }] } },
};

const source = (state: DetailState, shown: DetailView | undefined = view, over: Partial<DetailSource> = {}): DetailSource => ({
  state,
  view: shown,
  refreshing: false,
  refresh: async () => undefined,
  ...over,
});

const page = (given: DetailSource) => <DetailPage definition={definition} params={params} source={given} />;

const REPORT = 'Couldn\'t refresh lathe-4: The read timed out.';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a read that fails after the object was shown', () => {
  it('keeps what was shown and says so in the header\'s slot, with the plugin\'s Retry', () => {
    const retry = vi.fn();
    render(page(source({ kind: 'failed', message: 'The read timed out.', retry })));

    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    expect(screen.getByText(REPORT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry when asking again cannot help, and still says it', () => {
    render(page(source({ kind: 'failed', message: 'The read timed out.' })));

    expect(screen.getByText(REPORT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says nothing while the object is read', () => {
    render(page(source({ kind: 'ready' })));

    expect(screen.queryByText(/Couldn't refresh/)).toBeNull();
  });

  it('is put away with Dismiss, stays away for the same failure, and comes back for another one, and for the same words after a good read', () => {
    const { rerender } = render(page(source({ kind: 'failed', message: 'The read timed out.' })));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(screen.queryByText(REPORT)).toBeNull();

    rerender(page(source({ kind: 'failed', message: 'The read timed out.' })));
    expect(screen.queryByText(REPORT)).toBeNull();

    rerender(page(source({ kind: 'failed', message: 'The host refused it.' })));
    expect(screen.getByText('Couldn\'t refresh lathe-4: The host refused it.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    rerender(page(source({ kind: 'ready' })));
    rerender(page(source({ kind: 'failed', message: 'The host refused it.' })));
    expect(screen.getByText('Couldn\'t refresh lathe-4: The host refused it.')).toBeInTheDocument();
  });
});

describe('the user\'s own Refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('is followed by the failure it ended in, and is not called an update', async () => {
    const read = Promise.withResolvers<void>();
    const refresh = async () => read.promise;
    const { rerender } = render(page(source({ kind: 'ready' }, view, { refresh })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lathe-4' }));
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();

    // The read fails while it runs: the plugin keeps the object and says the read failed.
    rerender(page(source({ kind: 'failed', message: 'The read timed out.' }, view, { refresh })));
    await act(async () => {
      read.resolve();
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });

    expect(screen.queryByText('Updated')).toBeNull();
    expect(screen.queryByText('Refreshing…')).toBeNull();
    expect(screen.getByText(REPORT)).toBeInTheDocument();
  });
});

describe('the user\'s own Refresh that does not finish (S3)', () => {
  // An overview's refresh is the aggregate of the plugin's reads, so one that hangs or fails is enough: the page says so in the header's slot, with a Retry, and Refresh is available again.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says "Refresh did not finish", with a Retry, when the read rejects, and the command is available again', async () => {
    const read = Promise.withResolvers<void>();
    const refresh = vi.fn(async () => read.promise);
    render(page(source({ kind: 'ready' }, view, { refresh })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lathe-4' }));
    expect(screen.getByRole('button', { name: 'Refresh lathe-4', description: 'Refreshing' })).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      read.reject(new Error('the read failed'));
      await vi.advanceTimersByTimeAsync(0);
    });

    const operation = screen.getByRole('article', { name: 'Error: Refresh lathe-4' });
    expect(operation).toHaveTextContent('Refresh did not finish');
    expect(screen.queryByText('Refreshing…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh lathe-4' })).not.toHaveAttribute('aria-disabled');
    // What was on screen stays.
    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
  });

  it('says it after thirty seconds when the read never settles, and Dismiss puts it away', async () => {
    const refresh = vi.fn(async () => new Promise<void>(() => undefined));
    render(page(source({ kind: 'ready' }, view, { refresh })));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lathe-4' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_LIMIT_MS - 1);
    });
    expect(screen.getByText('Refreshing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh lathe-4', description: 'Refreshing' })).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByRole('article', { name: 'Error: Refresh lathe-4' })).toHaveTextContent('Refresh did not finish');
    expect(screen.getByRole('button', { name: 'Refresh lathe-4' })).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }));
    expect(screen.queryByText('Refresh did not finish')).toBeNull();
  });
});

describe('a not-found state (K2c-2): the title and the message say the one thing', () => {
  it('draws the plugin\'s title over its message, and keeps the object\'s name as the page\'s one heading', () => {
    render(page(source({ kind: 'not-found', title: 'lathe-4 was deleted', message: 'It no longer exists in north.' }, undefined)));

    expect(screen.getByRole('heading', { level: 1, name: 'lathe-4' })).toBeInTheDocument();
    expect(screen.getByText('lathe-4 was deleted')).toBeInTheDocument();
    expect(screen.getByText('It no longer exists in north.')).toBeInTheDocument();
    expect(screen.queryByText('lathe-4 was not found')).toBeNull();
  });

  it('draws the page\'s own title for a plugin that gives none', () => {
    render(page(source({ kind: 'not-found', message: 'Widget lathe-4 doesn\'t exist in north. It may have been deleted.' }, undefined)));

    expect(screen.getByText('lathe-4 was not found')).toBeInTheDocument();
    expect(screen.getByText('Widget lathe-4 doesn\'t exist in north. It may have been deleted.')).toBeInTheDocument();
  });
});
