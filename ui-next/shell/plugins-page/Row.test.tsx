import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginsModel, type PluginsModel } from './core/model';
import { fakeEntries, harness, inventoryEntry, settle, type FakeEntries } from './core/testing';
import type { InventoryEntry, StateKind } from './core/types';
import { acme } from '../../plugins/testing';
import { Row } from './Row';

// One plugin's row, over the page's real model and an invented inventory: what it says for each state a plugin can be in, what it says of a plugin that failed, how it is chosen, and when it is busy. Geometry and paint
// are the probe's; jsdom has no layout.

afterEach(cleanup);

type Patch = Partial<Omit<InventoryEntry, 'metadata'>>;

async function opened(plugins: readonly InventoryEntry[], entries?: FakeEntries) {
  const set = harness(plugins, entries === undefined ? {} : { entries });
  const model = createPluginsModel(set.deps);
  model.refresh();
  await settle();
  return { ...set, model };
}

const rowButton = (): HTMLElement => screen.getByRole('button');
const part = (name: string): HTMLElement | null => rowButton().querySelector<HTMLElement>(`[data-pl-part="${name}"]`);

const STATES: ReadonlyArray<readonly [StateKind, Patch, string]> = [
  ['running', { phase: 'Running' }, ''],
  ['starting', { phase: 'Starting' }, 'Starting'],
  ['stopping', { phase: 'Stopping' }, 'Stopping'],
  ['degraded', { phase: 'Degraded' }, 'Degraded'],
  ['disabled', { enabled: false }, 'Disabled'],
  ['stopped', { phase: 'Stopped' }, 'Stopped'],
  ['failed', { phase: 'Failed' }, 'Did not start'],
  ['removing', { phase: 'Uninstalling' }, 'Removing'],
  ['unknown', { phase: 'Mystery' }, 'Unknown'],
];

describe('what a row says of each state', () => {
  it.each(STATES)('a plugin that is %s: its state, its word, and the line it goes on with', async (kind, patch, word) => {
    const { model } = await opened([inventoryEntry('alpha', patch)]);
    render(<Row model={model} id="alpha" selected={false} />);

    expect(rowButton()).toHaveAttribute('data-pl-state', kind);
    expect(rowButton()).toHaveAttribute('data-pl-id', 'alpha');
    if (word === '') {
      expect(part('row-chip')).toBeNull();
    } else {
      expect(part('row-chip')).toHaveTextContent(word);
    }

    if (kind === 'failed') {
      // The line is the host's sentence for the failure, in place of the description.
      expect(part('row-sentence')).toHaveTextContent(model.row('alpha')?.state.sentence ?? 'no sentence');
      expect(part('row-line2')).not.toHaveTextContent('The alpha plugin.');
    } else {
      expect(part('row-sentence')).toBeNull();
      expect(part('row-line2')).toHaveTextContent('Fixture Labs · The alpha plugin.');
    }
  });

  it('says the sentence of a plugin whose build failed, after its chip', async () => {
    const { model } = await opened([inventoryEntry('alpha', { phase: 'BuildFailed' })]);
    render(<Row model={model} id="alpha" selected={false} />);

    expect(part('row-chip')).toHaveTextContent('Build failed');
    expect(part('row-sentence')).toHaveTextContent(model.row('alpha')?.state.sentence ?? 'no sentence');
    expect(part('row-sentence')?.previousElementSibling).toBe(part('row-chip'));
  });

  it('says the name, then the version, and hides its tile from assistive technology: the name beside it says what it is', async () => {
    const { model } = await opened([inventoryEntry('alpha', {}), inventoryEntry('beta', { metadata: { version: '' } })]);
    const { unmount } = render(<Row model={model} id="alpha" selected={false} />);

    expect(part('row-name')).toHaveTextContent('Alpha');
    expect(part('row-version')).toHaveTextContent('1.0.0');
    expect(rowButton()).toHaveAccessibleName('Alpha 1.0.0 Fixture Labs · The alpha plugin.');
    expect(part('row-tile')).toHaveAttribute('aria-hidden', 'true');
    unmount();

    render(<Row model={model} id="beta" selected={false} />);

    expect(part('row-name')).toHaveTextContent('Beta');
    expect(part('row-version')).toBeNull();
  });

  it('says what a manifest has when it leaves out the publisher or the description, and keeps the line', async () => {
    const { model } = await opened([inventoryEntry('alpha', { metadata: { author: null, description: '' } })]);
    render(<Row model={model} id="alpha" selected={false} />);

    expect(part('row-line2')).toBeInTheDocument();
    expect(part('row-line2')).toHaveTextContent(/^$/);
  });

  it('marks its two lines as the ones that may be cut, so the host\'s tip gives the whole text', async () => {
    const { model } = await opened([inventoryEntry('alpha', {})]);
    render(<Row model={model} id="alpha" selected={false} />);

    expect(rowButton().querySelectorAll('[data-ov-clip]')).toHaveLength(2);
  });

  it('is nothing for a plugin the list does not have', async () => {
    const { model } = await opened([inventoryEntry('alpha', {})]);
    const { container } = render(<Row model={model} id="nobody" selected={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the tile', () => {
  it('is the shared tile at 24 px, with the host\'s own glyph and no hue for a plugin whose interface has not loaded', async () => {
    const { model } = await opened([inventoryEntry('alpha', {})]);
    render(<Row model={model} id="alpha" selected={false} />);

    // The invented plugin has no loaded interface in the window's store, so it has the host's own glyph and no hue.
    expect(part('row-tile')).toHaveAttribute('data-size', '24');
    expect(part('row-tile')).not.toHaveAttribute('data-accent');
    expect(part('row-tile')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'box');
  });

  it('says the glyph and the hue the rail has for a plugin whose interface has loaded', async () => {
    const entries = fakeEntries([{ id: 'alpha', name: 'Alpha', phase: 'ready', contribution: acme({ rail: { label: 'Alpha', icon: 'server', order: 1 } }) }]);
    const { model } = await opened([inventoryEntry('alpha', {})], entries);
    render(<Row model={model} id="alpha" selected={false} />);

    expect(part('row-tile')).toHaveAttribute('data-accent', 'blue');
    expect(part('row-tile')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'server');
  });
});

describe('choosing a row', () => {
  const choose = async (patch: Patch = {}) => {
    const { model } = await opened([inventoryEntry('alpha', patch)]);
    const select = vi.fn<PluginsModel['select']>();
    return { select, view: render(<Row model={{ ...model, select }} id="alpha" selected={false} />) };
  };

  it('chooses its plugin on a click', async () => {
    const { select } = await choose();

    await userEvent.setup().click(rowButton());

    expect(select).toHaveBeenCalledExactlyOnceWith('alpha');
  });

  it('chooses its plugin on Enter and on Space, as a native button does', async () => {
    const { select } = await choose();
    const user = userEvent.setup();

    await user.tab();
    expect(rowButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenNthCalledWith(1, 'alpha');
    expect(select).toHaveBeenNthCalledWith(2, 'alpha');
  });

  it('is current only while it is the one selected', async () => {
    const { model } = await opened([inventoryEntry('alpha', {})]);
    const { rerender } = render(<Row model={model} id="alpha" selected={false} />);

    expect(rowButton()).not.toHaveAttribute('aria-current');
    expect(rowButton()).toHaveAttribute('data-pl-selected', 'false');

    rerender(<Row model={model} id="alpha" selected />);

    expect(rowButton()).toHaveAttribute('aria-current', 'true');
    expect(rowButton()).toHaveAttribute('data-pl-selected', 'true');
  });
});

describe('a row that is busy', () => {
  it('is busy while its plugin is starting, and is not while it runs', async () => {
    const starting = await opened([inventoryEntry('alpha', { phase: 'Starting' })]);
    const { unmount } = render(<Row model={starting.model} id="alpha" selected={false} />);

    expect(rowButton()).toHaveAttribute('aria-busy', 'true');
    unmount();

    const running = await opened([inventoryEntry('alpha', {})]);
    render(<Row model={running.model} id="alpha" selected={false} />);

    expect(rowButton()).not.toHaveAttribute('aria-busy');
  });

  it('is busy while the page has work under way on its plugin, and is not once the host has answered', async () => {
    const { model, actions } = await opened([inventoryEntry('alpha', {})]);
    const gate = Promise.withResolvers<undefined>();
    actions.reload.mockImplementationOnce(async () => gate.promise);
    render(<Row model={model} id="alpha" selected={false} />);

    act(() => {
      model.reload('alpha');
    });

    expect(rowButton()).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      gate.resolve(undefined);
      await settle();
    });

    expect(rowButton()).not.toHaveAttribute('aria-busy');
  });
});
