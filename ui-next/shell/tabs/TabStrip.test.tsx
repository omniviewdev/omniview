import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabsStore } from '../core/tabs';
import { boot, dest } from '../core/tabs/testing';
import { Shell } from '../Shell';

// The strip is read through the whole shell: it needs the tab model, the page region it controls and the ids they share. The model is the real one, over the fixture world's
// plugins (invented: cloud, stack, compute, database); nothing here is a real screen's word.

const PAGES = ['alpha', 'beta', 'gamma'] as const;

type Extras = { readonly onNewTab?: () => void; readonly pages?: readonly string[]; readonly active?: number };

/** A shell over a model that holds one tab for each of `pages` (cloud pages: Alpha, Beta, Gamma), the one at `active` (from 0) on screen. */
function mount({ onNewTab, pages = PAGES, active = 0 }: Extras = {}) {
  const h = boot({ home: false });
  const ids = h.openAll(pages);
  if (ids.length > 0) {
    h.store.goto(active + 1);
  }

  render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={({ id }) => <p>{`page of ${id}`}</p>} empty={<p>Nothing open</p>} onNewTab={onNewTab} />);
  return { h, ids, user: userEvent.setup() };
}

const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
const names = () => screen.queryAllByRole('tab').map((element) => element.getAttribute('aria-label'));
const selected = () => screen.getAllByRole('tab').filter((element) => element.getAttribute('aria-selected') === 'true').map((element) => element.getAttribute('aria-label'));

/** The close control of the tab with this title: the one button of its face that assistive technology does not see. */
const closeOf = (title: string): HTMLElement => {
  const face = tab(title).closest('[data-shell-part="tab"]');
  const close = face?.querySelector<HTMLElement>('button[aria-hidden="true"]');
  if (close === null || close === undefined) {
    throw new Error(`no close control for ${title}`);
  }

  return close;
};

afterEach(() => {
  cleanup();
});

describe('roles and names', () => {
  it('is a tablist named Open tabs with one tab for each of the model\'s, in order, and one of them selected', () => {
    mount({ active: 1 });

    const list = screen.getByRole('tablist', { name: 'Open tabs' });
    expect(within(list).getAllByRole('tab').map((element) => element.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(selected()).toEqual(['Beta']);
  });

  it('is no tablist at all with no tab', () => {
    mount({ pages: [] });

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('controls the one page region, which is labelled by the selected tab', () => {
    mount({ active: 2 });
    const panel = screen.getByRole('tabpanel', { name: 'Gamma' });

    for (const element of screen.getAllByRole('tab')) {
      expect(element).toHaveAttribute('aria-controls', panel.id);
    }

    expect(panel).toHaveAttribute('aria-labelledby', tab('Gamma').id);
  });

  it('has a close control for each tab for the pointer: hidden from assistive technology (a button may not sit in a tablist), out of the tab order, with its tooltip text', () => {
    mount();

    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      const close = closeOf(title);
      expect(close).toHaveAttribute('aria-hidden', 'true');
      expect(close).toHaveAttribute('tabindex', '-1');
      expect(close).not.toHaveAttribute('aria-label');
      expect(close).toHaveAttribute('data-ov-tip', `Close ${title}`);
    }

    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
  });

  it('tells a screen reader how to close a tab, since its close control is out of the tab order: Delete, on the tab itself', () => {
    mount();

    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      expect(tab(title)).toHaveAttribute('aria-keyshortcuts', 'Delete');
    }
  });

  it('has a New tab control only when the host gives one, with tabs or with none (an empty window has a way forward, decision A17)', () => {
    const first = mount();
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
    first.h.store.dispose();
    cleanup();

    const second = mount({ onNewTab: vi.fn() });
    expect(screen.getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    second.h.store.dispose();
    cleanup();

    mount({ onNewTab: vi.fn(), pages: [] });
    expect(screen.getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('says what a tab is in words as well as marks: unsaved changes, pinned, preview and needs attention', () => {
    const { h, ids } = mount();

    act(() => {
      h.store.setUnsaved(ids[0], true);
      h.store.pin(ids[1], true);
      h.store.markAttention(ids[2], 'warning');
    });

    expect(names()).toEqual(['Beta, pinned', 'Alpha, unsaved changes', 'Gamma, needs attention']);
  });

  it('tells two tabs that read alike by the qualifier the model derives, in the name and in the face', () => {
    const h = boot({ home: false });
    const [first, second] = [h.open(dest('compute', 'instances'), { how: 'new' }), h.open(dest('database', 'instances'), { how: 'new' })];
    render(<Shell registration={{ plugin: { name: 'Cloud' } }} tabs={h.store} renderPage={() => null} empty={null} />);

    const [one, two] = screen.getAllByRole('tab');
    const identity = (id: string) => h.store.selectors.identity(h.state(), id);
    expect(identity(first)?.name).not.toBe(identity(second)?.name);
    expect(one).toHaveAccessibleName(identity(first)?.name);
    expect(two).toHaveAccessibleName(identity(second)?.name);
    expect(one?.textContent).not.toBe(two?.textContent);
    expect(identity(first)?.qualifier).not.toBe('');
  });
});

describe('what tells two tabs apart: the connection by its name (the mock: a face carries no scope by default, and the muted text after the title tells tabs that would read alike apart)', () => {
  // A route carries a connection by its KEY; the page says its NAME, which is the scope's label and what the model tells twins apart by (C1g). The key is the scope's id and is drawn nowhere.
  const KEYS = { north: 'north-57a082bd74', south: 'south-0f3c9d21aa' } as const;

  /** A strip of tabs on the pages `[page, connection]`, the first on screen: every page is titled by its page, and says its connection by name. */
  function mountConnections(opened: ReadonlyArray<readonly [string, keyof typeof KEYS]>) {
    const store = createTabsStore({
      contributions: {
        describe: (route) => {
          const key = route.params.connection === KEYS.north ? KEYS.north : KEYS.south;
          const connection = key === KEYS.north ? 'north' : 'south';
          const title = route.contribution === 'nodes' ? 'Nodes' : 'Services';
          return { title, icon: 'box', pluginName: 'Acme', scope: { id: key, label: connection }, path: ['Acme', connection, title], facets: [] };
        },
        home: () => undefined,
      },
    });
    for (const [page, connection] of opened) {
      store.open({ route: { plugin: 'acme', contribution: page, params: { connection: KEYS[connection] } } }, { how: 'new' });
    }

    store.goto(1);
    render(<Shell registration={{ plugin: { name: 'Acme' } }} tabs={store} renderPage={() => null} empty={null} />);
    const text = (index: number) => screen.getAllByRole('tab')[index]?.textContent;
    return { store, text, tipOf: (index: number) => screen.getAllByRole('tab')[index]?.getAttribute('data-ov-tip') };
  }

  it('says the connection of each of two tabs that read alike, by its name: the face draws it after the title, the accessible name carries it, and the key is in no text, name or tip', () => {
    const { text, tipOf } = mountConnections([['nodes', 'north'], ['nodes', 'south']]);

    expect(screen.getAllByRole('tab').map((element) => element.getAttribute('aria-label'))).toEqual(['Nodes, north', 'Nodes, south']);
    expect([text(0), text(1)]).toEqual(['Nodesnorth', 'Nodessouth']);
    const everything = [document.body.textContent, ...[...document.body.querySelectorAll('[aria-label], [data-ov-tip]')].flatMap((element) => [element.getAttribute('aria-label'), element.getAttribute('data-ov-tip')])].join('\n');
    expect(everything).not.toContain('57a082bd74');
    expect(everything).not.toContain('0f3c9d21aa');
    expect(tipOf(0)).toContain('north');
  });

  it('says nothing of the connection on a tab that reads like no other, in its face (a window has one connection, and the strip names none), and still carries it in its accessible name and its tip', () => {
    const { text, tipOf } = mountConnections([['nodes', 'north'], ['services', 'north']]);

    expect([text(0), text(1)]).toEqual(['Nodes', 'Services']);
    expect(screen.getAllByRole('tab').map((element) => element.getAttribute('aria-label'))).toEqual(['Nodes, north', 'Services, north']);
    expect(tipOf(0)).toBe('Acme › north › Nodes');
  });

  it('tells only the twins apart: a third tab that reads like neither says no connection, whatever the others say', () => {
    const { text } = mountConnections([['nodes', 'north'], ['nodes', 'south'], ['services', 'north']]);

    expect([text(0), text(1), text(2)]).toEqual(['Nodesnorth', 'Nodessouth', 'Services']);
  });

  it('takes the qualifier off a tab when its twin closes: a lone tab draws none', () => {
    const { store, text } = mountConnections([['nodes', 'north'], ['nodes', 'south']]);
    expect(text(0)).toBe('Nodesnorth');

    act(() => {
      store.close(store.getSnapshot().order[1]);
    });

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(text(0)).toBe('Nodes');
  });
});

describe('the roving tab stop', () => {
  it('is one stop: the tab on screen, and the close controls are none', () => {
    mount({ active: 1 });

    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('follows the focus inside the strip, and goes back to the tab on screen when the focus leaves', async () => {
    const { user } = mount({ active: 1 });
    act(() => {
      tab('Alpha').focus();
    });
    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([0, -1, -1]);

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Gamma')).toHaveFocus();
    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([-1, -1, 0]);

    act(() => {
      tab('Gamma').blur();
    });
    expect(screen.getAllByRole('tab').map((element) => element.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('keeps one stop when the focus goes from a tab to its own close control', () => {
    mount({ active: 1 });
    act(() => {
      tab('Alpha').focus();
    });
    act(() => {
      closeOf('Alpha').focus();
    });

    expect(screen.getAllByRole('tab').filter((element) => element.tabIndex === 0)).toHaveLength(1);
  });
});

describe('keys on a focused tab', () => {
  it('moves the focus with ArrowRight and ArrowLeft, wrapping, and selects nothing', async () => {
    const { user, h } = mount();
    act(() => {
      tab('Alpha').focus();
    });

    await user.keyboard('{ArrowRight}');
    expect(tab('Beta')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(tab('Alpha')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Gamma')).toHaveFocus();
    expect(selected()).toEqual(['Alpha']);
    expect(h.active()).toBe(h.ids()[0]);
  });

  it('jumps to the first and the last with Home and End', async () => {
    const { user } = mount({ active: 1 });
    act(() => {
      tab('Beta').focus();
    });

    await user.keyboard('{End}');
    expect(tab('Gamma')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Alpha')).toHaveFocus();
    expect(selected()).toEqual(['Beta']);
  });

  it('selects the focused tab with Enter and with Space, the button\'s own click', async () => {
    const { user } = mount();
    act(() => {
      tab('Beta').focus();
    });

    await user.keyboard('{Enter}');
    expect(selected()).toEqual(['Beta']);
    act(() => {
      tab('Gamma').focus();
    });
    await user.keyboard(' ');
    expect(selected()).toEqual(['Gamma']);
  });

  it('closes the focused tab with Delete and puts the focus on its right neighbour', async () => {
    const { user, h } = mount();
    act(() => {
      tab('Alpha').focus();
    });

    await user.keyboard('{Delete}');
    expect(names()).toEqual(['Beta', 'Gamma']);
    expect(tab('Beta')).toHaveFocus();
    expect(h.ids()).toHaveLength(2);
  });

  it('closes with Backspace as well, and puts the focus on the left neighbour when it was the last tab', async () => {
    const { user } = mount({ active: 2 });
    act(() => {
      tab('Gamma').focus();
    });

    await user.keyboard('{Backspace}');
    expect(names()).toEqual(['Alpha', 'Beta']);
    expect(tab('Beta')).toHaveFocus();
  });

  it('closes a tab that is not on screen without moving the one that is', async () => {
    const { user } = mount({ active: 0 });
    act(() => {
      tab('Beta').focus();
    });

    await user.keyboard('{Delete}');
    expect(names()).toEqual(['Alpha', 'Gamma']);
    expect(selected()).toEqual(['Alpha']);
    expect(tab('Gamma')).toHaveFocus();
  });

  it('ignores every key that comes with a modifier', async () => {
    const { user } = mount();
    act(() => {
      tab('Beta').focus();
    });

    for (const modifier of ['Control', 'Alt', 'Meta', 'Shift']) {
      await user.keyboard(`{${modifier}>}{ArrowRight}{ArrowLeft}{Home}{End}{Delete}{Backspace}{/${modifier}}`);
    }

    expect(tab('Beta')).toHaveFocus();
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('leaves the keys it does not own to the browser', () => {
    mount();
    act(() => {
      tab('Beta').focus();
    });

    expect(fireEvent.keyDown(tab('Beta'), { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(tab('Beta'), { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' })).toBe(false);
  });

  it('wraps and closes for a single tab without throwing', async () => {
    const { user } = mount({ pages: ['alpha'] });
    act(() => {
      tab('Alpha').focus();
    });

    await user.keyboard('{ArrowRight}{ArrowLeft}{Home}{End}');
    expect(tab('Alpha')).toHaveFocus();
    await user.keyboard('{Delete}');
    expect(screen.getByText('Nothing open')).toBeInTheDocument();
  });
});

describe('the mouse', () => {
  it('selects a tab on the press, as a browser\'s tabs do', async () => {
    const { user } = mount();

    await user.pointer({ keys: '[MouseLeft>]', target: tab('Gamma') });
    expect(selected()).toEqual(['Gamma']);
  });

  it('selects a tab on the click, and a touch only on the click so a swipe still scrolls the strip', async () => {
    const { user } = mount();

    await user.pointer({ keys: '[TouchA>]', target: tab('Beta') });
    expect(selected()).toEqual(['Alpha']);
    await user.pointer({ keys: '[/TouchA]', target: tab('Beta') });
    expect(selected()).toEqual(['Beta']);

    await user.click(tab('Gamma'));
    expect(selected()).toEqual(['Gamma']);
  });

  it('closes a tab on a middle click, and does not select it first', () => {
    const { h } = mount();

    fireEvent(tab('Beta'), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));

    expect(names()).toEqual(['Alpha', 'Gamma']);
    expect(selected()).toEqual(['Alpha']);
    expect(h.ids()).toHaveLength(2);
  });

  it('stops the middle button\'s autoscroll on the press, and leaves the other buttons alone', () => {
    mount();

    expect(fireEvent.mouseDown(tab('Beta'), { button: 1 })).toBe(false);
    expect(fireEvent.mouseDown(tab('Beta'), { button: 0 })).toBe(true);
    fireEvent(tab('Beta'), new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }));
    expect(names()).toHaveLength(3);
  });

  it('closes the tab whose close control is clicked, and leaves the tab on screen where it is', async () => {
    const { user } = mount();

    await user.click(closeOf('Beta'));
    expect(names()).toEqual(['Alpha', 'Gamma']);
    expect(selected()).toEqual(['Alpha']);

    await user.click(closeOf('Alpha'));
    expect(names()).toEqual(['Gamma']);
    expect(selected()).toEqual(['Gamma']);
  });

  it('runs the host\'s new-tab action from the New tab control', async () => {
    const onNewTab = vi.fn();
    const { user } = mount({ onNewTab });

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });
});

describe('layout it cannot see', () => {
  it('reveals the tab on screen without throwing or scrolling when nothing has a layout (jsdom has none)', () => {
    const { h, ids } = mount({ pages: Array.from({ length: 14 }, (_item, index) => `page-${String(index)}`) });
    const scroller = screen.getByRole('tablist');

    expect(() => {
      act(() => {
        h.store.activate(ids[13]);
        h.store.activate(ids[0]);
      });
      fireEvent.keyDown(tab(/Page-1$/), { key: 'End' });
    }).not.toThrow();
    expect(scroller.scrollLeft).toBe(0);
  });

  it('reveals a tab that is cut off, by the distance it is out of the strip', () => {
    const { h, ids } = mount();
    const scroller = screen.getByRole('tablist');
    const rect = (left: number, right: number) => () => ({ left, right, width: right - left, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON: () => ({}) });
    scroller.getBoundingClientRect = rect(0, 200);
    const face = scroller.querySelector('[data-tab-id="' + ids[2] + '"]')!;
    (face as HTMLElement).getBoundingClientRect = rect(260, 400);

    act(() => {
      h.store.activate(ids[2]);
    });

    expect(scroller.scrollLeft).toBe(200);
  });
});
