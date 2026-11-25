import { MenuHost, type MenuItem } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelNewSessionMenu } from './host';
import { NewSession } from './SessionTabs';

// The `+` of a tool and, when the tool offers a choice of what to start, the arrow beside it that opens the choice on the window's one menu host. The tool's words and items are its own (the terminal's are its shells,
// `terminal/profiles.test.ts`); what is checked here is that the panel draws the arrow only for a tool that has items, that the `+` still starts the default, and that a choice reaches the tool.

afterEach(cleanup);

/** A menu whose items the test can change, as a tool's store does. */
function changing(initial: readonly MenuItem[]) {
  let items = initial;
  const listeners = new Set<() => void>();
  const menu: PanelNewSessionMenu = {
    label: 'Choose a shell',
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => items,
  };
  return {
    menu,
    set: (next: readonly MenuItem[]) => {
      items = next;
      listeners.forEach((listener) => { listener(); });
    },
  };
}

const action = (id: string, label: string, onSelect: () => void = () => undefined): MenuItem => ({ kind: 'action', id, label, onSelect });

function mount(menu: PanelNewSessionMenu | undefined, onStart: () => void = () => undefined) {
  return render(
    <MenuHost>
      <NewSession label="New terminal" onStart={onStart} {...(menu === undefined ? {} : { menu })} />
    </MenuHost>,
  );
}

const open = () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Choose a shell' }), { key: 'ArrowDown' });
};

describe('the `+` with a choice', () => {
  it('draws only the `+` for a tool that offers no choice, and for one whose choice is empty', () => {
    mount(undefined);
    expect(screen.queryByRole('button', { name: 'Choose a shell' })).toBeNull();
    cleanup();
    mount(changing([]).menu);
    expect(screen.queryByRole('button', { name: 'Choose a shell' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New terminal' })).toBeTruthy();
  });

  it('starts the default with the `+`, and opens nothing', () => {
    const onStart = vi.fn();
    mount(changing([action('bash', 'bash')]).menu, onStart);
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the tool\'s items from the arrow, and the item chosen is the tool\'s to run, not the `+`\'s', () => {
    const onStart = vi.fn();
    const chosen = vi.fn();
    mount(changing([action('bash', 'bash'), action('zsh', 'zsh', chosen)]).menu, onStart);
    const arrow = screen.getByRole('button', { name: 'Choose a shell' });
    expect(arrow.getAttribute('aria-haspopup')).toBe('menu');
    open();
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['bash', 'zsh']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'zsh' }));
    expect(chosen).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows the items the tool has when the menu is opened, and draws the arrow when the tool first has some', () => {
    const tool = changing([]);
    mount(tool.menu);
    expect(screen.queryByRole('button', { name: 'Choose a shell' })).toBeNull();
    act(() => {
      tool.set([action('fish', 'fish')]);
    });
    open();
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['fish']);
  });
});
