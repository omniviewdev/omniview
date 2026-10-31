import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActivePageNavigationContext, type ActivePageNavigation } from '../activePageNavigation';
import { NewTabLauncher } from './NewTabLauncher';

const mocks = vi.hoisted(() => ({
  plugins: [] as unknown[] | undefined,
  registrations: new Map<string, { routes: unknown[] }>(),
}));

vi.mock('@/hooks/plugin/usePluginManager', () => ({
  usePluginManager: () => ({ plugins: { isLoading: false, data: mocks.plugins } }),
}));

vi.mock('@/features/plugins', () => ({
  usePluginService: () => ({ registrations: mocks.registrations }),
}));

function installed(...names: string[]) {
  mocks.plugins = names.map((name) => ({ id: name.toLowerCase(), metadata: { name, icon: 'LuBox' } }));
  mocks.registrations = new Map(names.map((name) => [name.toLowerCase(), { routes: [{ path: '' }] }]));
}

function renderLauncher(pathname = '/') {
  const navigation = {
    pathname,
    search: '',
    navigate: vi.fn(),
    openInNewTab: vi.fn(),
    openInNewWindow: vi.fn(),
  } satisfies ActivePageNavigation;
  render(
    <ActivePageNavigationContext.Provider value={navigation}>
      <NewTabLauncher />
    </ActivePageNavigationContext.Provider>,
  );
  return navigation;
}

async function openMenuWithShortcut(user: UserEvent) {
  await user.keyboard('{Control>}t{/Control}');
  return screen.findByRole('menu', { name: 'New tab' });
}

describe('NewTabLauncher', () => {
  it('opens the only plugin with pages directly, without a menu', async () => {
    installed('Kubernetes');
    const user = userEvent.setup();
    const navigation = renderLauncher();

    await user.click(screen.getByRole('button', { name: 'New Kubernetes tab' }));

    expect(navigation.openInNewTab).toHaveBeenCalledWith('/_plugin/kubernetes', { background: false });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens Home when no plugin has pages', async () => {
    installed();
    const user = userEvent.setup();
    const navigation = renderLauncher();

    await user.keyboard('{Control>}t{/Control}');

    expect(navigation.openInNewTab).toHaveBeenCalledWith('/', { background: false });
  });

  it('lists the plugins on Ctrl/Cmd+T; type-ahead and Enter open the chosen one in a new tab', async () => {
    installed('Proxmox', 'Kubernetes');
    const user = userEvent.setup();
    const navigation = renderLauncher();

    const menu = await openMenuWithShortcut(user);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Kubernetes'),
      expect.stringContaining('Proxmox'),
    ]);

    await user.keyboard('p');
    await user.keyboard('{Enter}');

    expect(navigation.openInNewTab).toHaveBeenCalledWith('/_plugin/proxmox', { background: false });
    expect(menu).not.toBeInTheDocument();
  });

  it('opens a new window with Shift+Enter and a background tab with Ctrl/Cmd+Enter', async () => {
    installed('Proxmox', 'Kubernetes');
    const user = userEvent.setup();
    const navigation = renderLauncher();

    await openMenuWithShortcut(user);
    await user.keyboard('k');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(navigation.openInNewWindow).toHaveBeenCalledWith('/_plugin/kubernetes');

    await openMenuWithShortcut(user);
    await user.keyboard('p');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(navigation.openInNewTab).toHaveBeenCalledWith('/_plugin/proxmox', { background: true });
  });

  it('starts on the plugin of the active tab', async () => {
    installed('Kubernetes', 'Proxmox');
    const user = userEvent.setup();
    const navigation = renderLauncher('/_plugin/proxmox/connection/homelab');

    await openMenuWithShortcut(user);
    await user.keyboard('{Enter}');

    expect(navigation.openInNewTab).toHaveBeenCalledWith('/_plugin/proxmox', { background: false });
  });

  it('opens the clicked plugin in a background tab on middle click, and in front with Shift', async () => {
    installed('Kubernetes', 'Proxmox');
    const user = userEvent.setup();
    const navigation = renderLauncher();

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.pointer({ keys: '[MouseMiddle]', target: await screen.findByRole('menuitem', { name: /Kubernetes/ }) });
    expect(navigation.openInNewTab).toHaveBeenLastCalledWith('/_plugin/kubernetes', { background: true });

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.keyboard('{Shift>}');
    await user.pointer({ keys: '[MouseMiddle]', target: await screen.findByRole('menuitem', { name: /Proxmox/ }) });
    await user.keyboard('{/Shift}');
    expect(navigation.openInNewTab).toHaveBeenLastCalledWith('/_plugin/proxmox', { background: false });
  });

  it('names the new-window action when Shift is held as the menu opens', async () => {
    installed('Kubernetes', 'Proxmox');
    const user = userEvent.setup();
    renderLauncher('/_plugin/kubernetes');

    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: 'New tab' }));

    expect(await screen.findByRole('menuitem', { name: /Kubernetes/ })).toHaveTextContent('New window');
    await user.keyboard('{/Shift}');
  });

  it('does nothing until the plugin inventory has loaded', async () => {
    mocks.plugins = undefined;
    const user = userEvent.setup();
    const navigation = renderLauncher();

    await user.keyboard('{Control>}t{/Control}');

    expect(screen.getByRole('button', { name: 'New tab' })).toBeDisabled();
    expect(navigation.openInNewTab).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
