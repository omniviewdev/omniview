import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connection, connectionStore, hostConnections, pluginSource, readyEntry } from './homeTesting';
import { NoTabs } from './NoTabs';

// The empty window: the Home page with the line that says no tab is open. The page is the one the Home tab draws (`homePage.tsx`, `HomeContent`), so what it lists and what a choice does is held there (`homePage.test.tsx`); what
// is held here is what the window adds, and that the window reads what it is given as the tab does: the plugins from the plugin store and the connections from the window's connections.

afterEach(cleanup);

const none = () => undefined;
const connections = () => screen.getByRole('region', { name: 'Connections' });

describe('the empty window', () => {
  it('is the page with its line, inside the part the shell\'s probes read', () => {
    const { container } = render(<NoTabs plugins={pluginSource([readyEntry('acme', 'Acme')])} onOpen={none} />);

    const part = container.querySelector('[data-shell-part="home"]');
    expect(part).not.toBeNull();
    expect(part).toContainElement(screen.getByRole('heading', { level: 1, name: 'Home' }));
    expect(part).toContainElement(screen.getByText('No tabs are open.'));
    expect(part).toContainElement(screen.getByRole('region', { name: 'Plugins you can open' }));
  });

  it('opens a plugin by its id alone', async () => {
    const onOpen = vi.fn<(id: string) => void>();
    render(<NoTabs plugins={pluginSource([readyEntry('acme', 'Acme'), readyEntry('beta', 'Beta')])} onOpen={onOpen} />);

    await userEvent.setup().click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: 'Beta' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('beta');
  });

  it('draws no connections unless the window has some', () => {
    render(<NoTabs plugins={pluginSource([readyEntry('acme', 'Acme')])} onOpen={none} />);

    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
    expect(screen.queryByText('Reading connections…')).toBeNull();
  });

  it('draws the connections the window knows and opens one through the window\'s actions, by its plugin and key and with the disposition the click chose', async () => {
    const host = hostConnections(connectionStore([connection('acme', 'k1', 'staging')]));
    render(<NoTabs plugins={pluginSource([readyEntry('acme', 'Acme')])} connections={host} onOpen={none} />);

    await userEvent.setup().click(within(connections()).getByRole('button', { name: 'staging Connected' }));

    expect(host.go).toHaveBeenCalledTimes(1);
    expect(host.go).toHaveBeenCalledWith('acme', 'k1', { how: 'smart', source: 'home' });
  });

  it('says what the window knows of the connections when it has not read them yet', () => {
    render(<NoTabs plugins={pluginSource([readyEntry('acme', 'Acme')])} connections={hostConnections(connectionStore([], { loaded: false }))} onOpen={none} />);

    expect(within(connections()).getByText('Reading connections…')).toBeInTheDocument();
  });
});
