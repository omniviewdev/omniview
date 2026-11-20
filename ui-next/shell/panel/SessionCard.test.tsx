import { ThemeProvider, type LinkActivation } from '@omniviewdev/kit';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, type PanelStore, type Route } from '../core/panel';
import { PanelProvider } from './context';
import type { PanelCard } from './host';
import { SessionCard } from './SessionCard';
import { staticPanel } from './testing';

// The card of a session, as it is drawn (the hover card's content): what a session its plugin's unload ended says while the plugin is off, and that the way back to its resource works again when the plugin
// returns (A21). The words of the card are `card.test.ts`'s; the model is `core/panel`'s; what is under test here is that the card follows the model while it is open, and that what cannot work cannot be pressed.

const route: Route = { plugin: 'acme', contribution: 'item', params: { name: 'worker' } };
const described: PanelCard = { kind: 'Logs', resource: { label: 'Item worker', kind: 'Item', route }, facts: [['Source', 'worker/app']] };
const UNLOADED = 'The plugin was unloaded.';

type Mounted = { readonly store: PanelStore; readonly open: Mock<(activation: LinkActivation) => void>; readonly user: UserEvent };

function mount(): Mounted {
  const store = createPanelStore();
  store.registerTool({ id: 'logs', label: 'Logs', icon: 'scroll-text', order: 20 });
  store.syncPlugins([{ id: 'acme', tools: [] }]);
  store.openSession({ id: 's1', tool: 'logs', plugin: 'acme', title: 'worker/app', state: 'running', route });
  const open = vi.fn<(activation: LinkActivation) => void>();
  const panel = staticPanel({ store, cardOf: () => described, linkOf: (to) => ({ href: `#/${to.plugin}/${to.contribution}`, open }) });
  render(
    <ThemeProvider>
      <PanelProvider panel={panel}>
        <SessionCard id="s1" />
      </PanelProvider>
    </ThemeProvider>,
  );
  return { store, open, user: userEvent.setup() };
}

const unload = (store: PanelStore) => {
  act(() => {
    store.syncPlugins([]);
  });
};

const reload = (store: PanelStore) => {
  act(() => {
    store.syncPlugins([{ id: 'acme', tools: [] }]);
  });
};

afterEach(() => {
  cleanup();
});

describe('the card of a session whose plugin is live', () => {
  it('names the resource as a link to its page, and has a button that opens it', async () => {
    const { open, user } = mount();
    expect(screen.getByRole('link', { name: 'Item worker' })).toHaveAttribute('href', '#/acme/item');
    const button = screen.getByRole('button', { name: 'Open Item' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('the card of a session the unload of its plugin ended (A21)', () => {
  it('says the plugin was unloaded, in the state and as the reason, and the session is ended', () => {
    const { store } = mount();
    unload(store);
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getAllByText(UNLOADED).length).toBeGreaterThan(0);
    expect(store.getSnapshot().sessions.s1).toMatchObject({ state: 'ended', held: true, cause: UNLOADED });
  });

  it('cannot open the resource while the plugin is off: its name is text, not a link, and the button is unavailable for the sentence the card prints, so pressing it does nothing', async () => {
    const { store, open, user } = mount();
    unload(store);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Item worker')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Open Item' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(UNLOADED);
    // The card prints the same sentence where it is read: under the state.
    expect(screen.getByText(UNLOADED, { selector: 'p' })).toBeInTheDocument();
    await user.click(button);
    expect(open).not.toHaveBeenCalled();
  });

  it('works again when the plugin returns, while the card is open: the name is a link and the button opens the resource; the session is still ended', async () => {
    const { store, open, user } = mount();
    unload(store);
    reload(store);
    expect(screen.getByRole('link', { name: 'Item worker' })).toHaveAttribute('href', '#/acme/item');
    const button = screen.getByRole('button', { name: 'Open Item' });
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions.s1).toMatchObject({ state: 'ended', held: true });
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });

  it('is the same card the second time the plugin goes: it does not remember that it was back', async () => {
    const { store, open, user } = mount();
    unload(store);
    reload(store);
    unload(store);
    expect(screen.queryByRole('link')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open Item' }));
    expect(open).not.toHaveBeenCalled();
  });
});
