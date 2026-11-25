import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePalette } from '../core/palette/testing';
import { boot } from '../core/tabs/testing';
import { Shell } from '../Shell';
import type { PanelBindings } from '../panel/host';
import { staticPanel } from '../panel/testing';
import { createAnnouncer, type PaletteBindings } from './host';
import { installDialog, providers } from './testing';

// The top row's Search control (ch16 S6: the Window actions, Search `⌘K`) and the palette through the whole shell: the control opens it, the chord opens it from the page, the window's own
// chords stay out of the page while it is open, and the focus comes back to the control. The model is the real one over the fixture world; the shell is the real one too.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountShell(platform = 'MacIntel', withPalette = true, pages: readonly string[] = ['instances', 'volumes', 'buckets'], panel: PanelBindings | undefined = undefined) {
  installDialog();
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const h = boot({ home: false });
  h.openAll([...pages]);
  h.store.goto(1);
  const announcer = createAnnouncer();
  const f = makePalette({ tabs: h, announce: announcer.announce, platform: platform.startsWith('Mac') ? 'mac' : 'other' });
  for (const provider of providers(f)) {
    f.palette.registerProvider(provider);
  }

  const palette: PaletteBindings = { store: f.palette, announcer, opening: () => ({}) };
  const view = render(
    <Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={() => <input aria-label="A field" />} empty={null} panel={panel} palette={withPalette ? palette : undefined} />,
  );
  return { h, f, view, user: userEvent.setup() };
}

const control = (): HTMLElement => screen.getByRole('button', { name: /^Search/ });

describe('the Search control', () => {
  it('is a button named Search in the top row, with its chord as text and as a keyboard shortcut, and opens a dialog', () => {
    mountShell();
    const button = control();
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(button.querySelector('kbd')).toHaveTextContent('⌘K');
    expect(button).toHaveAttribute('data-ov-tip', 'Search\n⌘K');
    expect(button.closest('[data-shell-region="topRow"]')).not.toBeNull();
    expect(button).toHaveAttribute('data-shell-part', 'search');
  });

  it('is named by its label and the chord it shows, so the name holds what is drawn: a voice user who reads "Search ⌘K" can say it (WCAG 2.5.3)', () => {
    mountShell();
    expect(control()).toHaveAccessibleName('Search ⌘K');
  });

  it('says Control K elsewhere', () => {
    mountShell('Linux x86_64');
    expect(control()).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    expect(control().querySelector('kbd')).toHaveTextContent('Ctrl+K');
    expect(control()).toHaveAccessibleName('Search Ctrl+K');
    expect(control()).toHaveAttribute('data-ov-tip', 'Search\nCtrl+K');
  });

  it('is one Tab stop of its own, reached with Tab after the tab strip: a disabled or skipped control would not be', async () => {
    const { user } = mountShell();
    const strip = screen.getByRole('tablist', { name: 'Open tabs' });
    act(() => {
      within(strip).getByRole('tab', { selected: true }).focus();
    });
    for (let presses = 0; presses < 8 && document.activeElement !== control(); presses += 1) {
      await user.tab();
    }

    expect(control()).toHaveFocus();
    expect(strip.compareDocumentPosition(control()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the palette when it is pressed, and Escape gives the focus back to it', async () => {
    const { user } = mountShell();
    await user.click(control());
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(control()).toHaveFocus();
    });
  });

  it('is the opener whatever the browser does with a press on a button: it takes the focus itself, so Escape comes back to it (Safari does not focus a button it was clicked on)', async () => {
    mountShell();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(control());
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => {
      expect(control()).toHaveFocus();
    });
  });

  it('is not drawn by a shell that has no palette: the window actions stay empty and hidden', () => {
    mountShell('MacIntel', false);
    expect(screen.queryByRole('button', { name: /^Search/ })).toBeNull();
    const actions = document.querySelector('[data-shell-part="actions"]');
    expect(actions).toHaveAttribute('aria-hidden', 'true');
    expect(actions?.childElementCount).toBe(0);
  });

  it('holds the window actions as a named group when it is drawn', () => {
    mountShell();
    const group = screen.getByRole('group', { name: 'Window actions' });
    expect(within(group).getByRole('button', { name: /^Search/ })).toBeInTheDocument();
  });
});

describe('the palette in the window', () => {
  it('opens with Command K from a field in the page, and the chord is the palette\'s alone: the page does not see it', async () => {
    const { user } = mountShell();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    screen.getAllByLabelText('A field')[0].focus();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    expect(seen.mock.calls.filter(([event]) => (event as KeyboardEvent).key === 'k')).toHaveLength(0);
    document.removeEventListener('keydown', seen);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.getAllByLabelText('A field')[0]).toHaveFocus();
    });
  });

  it('keeps Command W, Command 2 and Command J from the tabs and the panel behind it while it is open, and gives them back once it is closed', async () => {
    const panel = staticPanel();
    const { user, h } = mountShell('MacIntel', true, undefined, panel);
    const before = h.ids();
    expect(panel.store.getSnapshot().open).toBe(false);
    await user.keyboard('{Meta>}k{/Meta}');
    await user.keyboard('{Meta>}w{/Meta}');
    await user.keyboard('{Meta>}2{/Meta}');
    await user.keyboard('{Meta>}j{/Meta}');
    expect(h.ids()).toEqual(before);
    expect(h.active()).toBe(before[0]);
    expect(panel.store.getSnapshot().open).toBe(false);
    await user.keyboard('{Escape}');
    await user.keyboard('{Meta>}2{/Meta}');
    expect(h.active()).toBe(before[1]);
    await user.keyboard('{Meta>}w{/Meta}');
    expect(h.ids()).toHaveLength(before.length - 1);
    await user.keyboard('{Meta>}j{/Meta}');
    expect(panel.store.getSnapshot().open).toBe(true);
  });

  it('opens a page from the palette into the window, one that is not open: the tab on screen goes to it and the strip marks it selected', async () => {
    const { user, h } = mountShell('MacIntel', true, ['instances', 'volumes']);
    expect(h.titles()).not.toContain('Buckets');
    await user.keyboard('{Meta>}k{/Meta}');
    await user.keyboard('#');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.titles()).toContain('Buckets');
    const opened = within(screen.getByRole('tablist', { name: 'Open tabs' })).getAllByRole('tab').find((tab) => tab.getAttribute('aria-label') === 'Buckets');
    expect(opened).toHaveAttribute('aria-selected', 'true');
  });

  it('draws the dialog inside the window, and removes it from the document when it closes', async () => {
    const { user } = mountShell();
    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Search' });
    expect(dialog.closest('[data-shell-part="window"]')).not.toBeNull();
    await act(async () => {
      await user.keyboard('{Escape}');
    });
    expect(document.querySelector('dialog')).toBeNull();
  });
});
