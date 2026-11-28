import type { MenuSource } from '@omniviewdev/kit';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuHost, menuTrigger, useMenu, type MenuAction, type MenuItem } from './index';

const action = (id: string, label: string, onSelect: () => void = () => undefined): MenuAction => ({ kind: 'action', id, label, onSelect });
const panel = (name?: string) => name === undefined ? screen.getByRole('menu') : screen.getByRole('menu', { name });
const item = (name: string) => screen.getByRole('menuitem', { name });
const key = (value: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key: value });

function metrics() {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
    return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 200, 120) : new DOMRect(100, 60, 60, 24);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('delegated MenuHost', () => {
  it('measures the trigger and popup once, then performs no layout reads on navigation or rerender', () => {
    const layout = metrics();
    const { rerender } = render(
      <StrictMode>
        <MenuHost menus={{ root: [action('inspect', 'Inspect'), action('archive', 'Archive')] }}>
          <button {...menuTrigger('root')}>Actions</button>
        </MenuHost>
      </StrictMode>,
    );
    const trigger = screen.getByRole('button');
    expect(layout).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const popup = panel();
    expect(layout.mock.contexts).toEqual([trigger, popup]);
    key('End');
    key('i');
    rerender(
      <StrictMode>
        <MenuHost menus={{ root: [action('inspect', 'Inspect again'), action('archive', 'Archive')] }}>
          <button {...menuTrigger('root')}>Actions</button>
        </MenuHost>
      </StrictMode>,
    );
    expect(layout.mock.contexts).toEqual([trigger, popup]);
    key('Escape');
    expect(layout.mock.contexts).toEqual([trigger, popup]);
  });

  it('renders no menu and resolves no rows until invoked; two triggers share one popup', () => {
    const first = vi.fn();
    const resolver = vi.fn((id: string | undefined) => id === undefined ? null : [action(id, `Inspect ${id}`, first)]);
    render(
      <StrictMode>
        <MenuHost menus={{ row: resolver }}>
          <button {...menuTrigger('row', 'a')}>A actions</button>
          <button {...menuTrigger('row', 'b')}>B actions</button>
          <button {...menuTrigger('row')}>No actions</button>
        </MenuHost>
      </StrictMode>,
    );
    const a = screen.getByRole('button', { name: 'A actions' });
    const b = screen.getByRole('button', { name: 'B actions' });
    expect(a.getAttribute('aria-haspopup')).toBe('menu');
    expect(a.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(resolver).not.toHaveBeenCalled();

    expect(fireEvent.click(screen.getByRole('button', { name: 'No actions' }), { detail: 1 })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(a, { detail: 1 });
    expect(document.activeElement).toBe(panel('A actions'));
    expect(a.getAttribute('aria-controls')).toBe(panel().id);
    expect(a.getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerDown(b, { button: 0 });
    fireEvent.click(b, { detail: 1 });
    expect(screen.getAllByRole('menu')).toEqual([panel('B actions')]);
    expect(a.hasAttribute('aria-controls')).toBe(false);
    expect(a.hasAttribute('aria-expanded')).toBe(false);
    expect(item('Inspect b').isConnected).toBe(true);
    expect(resolver.mock.calls).toEqual([[undefined], ['a'], ['b']]);
    expect(first).not.toHaveBeenCalled();

    expect(fireEvent.pointerDown(b, { button: 0 })).toBe(false);
    fireEvent.click(b, { detail: 1 });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(b.hasAttribute('aria-expanded')).toBe(false);
    expect(document.activeElement).toBe(b);
  });

  it('accepts a registered empty menu ID but not a missing trigger ID', () => {
    const emptyId = '';
    const resolve = vi.fn(() => [action('inspect', 'Inspect')]);
    render(
      <MenuHost menus={{ [emptyId]: resolve }}>
        <button data-ov-menu-mode="dropdown">Missing ID</button>
        <button {...menuTrigger(emptyId, '')}>Empty ID</button>
      </MenuHost>,
    );
    expect(fireEvent.click(screen.getByRole('button', { name: 'Missing ID' }))).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(fireEvent.click(screen.getByRole('button', { name: 'Empty ID' }))).toBe(false);
    expect(resolve).toHaveBeenCalledExactlyOnceWith('');
    expect(panel().getAttribute('data-ov-menu-owner')).toBe('');
    expect(document.activeElement).toBe(item('Inspect'));
  });

  it('honors the trigger’s earlier default prevention and supports assistive click and pointer entry policies', () => {
    const resolve = vi.fn(() => [action('open', 'Open')]);
    render(
      <MenuHost menus={{ actions: resolve }}>
        <button {...menuTrigger('actions')} onClick={(event) => {
          event.preventDefault();
        }}>Intercept click</button>
        <button {...menuTrigger('actions')} onKeyDown={(event) => {
          event.preventDefault();
        }}>Intercept key</button>
        <button {...menuTrigger('actions')}>Assistive</button>
        <button {...menuTrigger('actions')} data-ov-menu-pointer-focus="first">Pointer</button>
        <div role="button" tabIndex={0} {...menuTrigger('actions')}>Custom trigger</div>
      </MenuHost>,
    );
    const intercepted = screen.getByRole('button', { name: 'Intercept click' });
    expect(fireEvent.keyDown(intercepted, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(intercepted, { key: ' ' })).toBe(true);
    fireEvent.click(intercepted, { detail: 0 });
    fireEvent.click(intercepted, { detail: 1 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Intercept key' }), { key: 'ArrowDown' });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Assistive' }), { detail: 0 });
    expect(document.activeElement).toBe(item('Open'));
    key('Escape');
    fireEvent.click(screen.getByRole('button', { name: 'Pointer' }), { detail: 1 });
    expect(document.activeElement).toBe(item('Open'));
    key('Escape');
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Custom trigger' }), { key: 'Enter' })).toBe(false);
    expect(document.activeElement).toBe(item('Open'));
  });

  it.each(['button', 'submit', 'reset', 'image'])('honors keyboard click veto on input type=%s', (type) => {
    const resolve = vi.fn(() => [action('open', 'Open')]);
    render(
      <MenuHost menus={{ actions: resolve }}>
        <input {...menuTrigger('actions')} type={type} aria-label="Actions" onClick={(event) => {
          event.preventDefault();
        }} />
      </MenuHost>,
    );
    const trigger = screen.getByLabelText('Actions');
    expect(fireEvent.keyDown(trigger, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(trigger, { key: ' ' })).toBe(true);
    expect(fireEvent.click(trigger, { detail: 0 })).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('wraps, skips disabled entries, and supports multi-character search and repeated-letter cycling', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const entries: readonly MenuItem[] = [
      { ...action('unavailable', 'Unavailable', run), disabled: 'Requires a connection' },
      action('inspect', 'Inspect'),
      action('archive', 'Archive'),
      action('attach', 'Attach'),
      action('delete', 'Delete'),
    ];
    render(<MenuHost menus={{ actions: entries }}><button {...menuTrigger('actions')}>Actions</button></MenuHost>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('Delete'));
    key('ArrowDown');
    expect(document.activeElement).toBe(item('Inspect'));
    key('ArrowUp');
    expect(document.activeElement).toBe(item('Delete'));
    key('Home');
    expect(document.activeElement).toBe(item('Inspect'));
    key('End');
    expect(document.activeElement).toBe(item('Delete'));
    key('a');
    expect(document.activeElement).toBe(item('Archive'));
    key('a');
    expect(document.activeElement).toBe(item('Attach'));
    key('r');
    expect(document.activeElement).toBe(item('Archive'));
    act(() => {
      vi.advanceTimersByTime(701);
    });
    key('i');
    expect(document.activeElement).toBe(item('Inspect'));

    const disabled = item('Unavailable');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.getAttribute('data-ov-tip')).toBe('Requires a connection');
    expect(disabled.getAttribute('aria-description')).toBe('Requires a connection');
    fireEvent.pointerMove(disabled, { pointerType: 'mouse' });
    expect(document.activeElement).toBe(item('Inspect'));
    fireEvent.click(disabled);
    key('Home');
    key('u');
    expect(document.activeElement).toBe(disabled);
    key('Enter');
    key('ArrowDown');
    expect(document.activeElement).toBe(item('Inspect'));
    expect(run).not.toHaveBeenCalled();
    expect(panel().isConnected).toBe(true);
  });

  it('uses Space within a fresh typeahead prefix and activates only after the prefix expires', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const other = vi.fn();
    render(
      <MenuHost menus={{ root: [action('close', 'Close tab', close), action('others', 'Close other tabs', other)] }}>
        <button {...menuTrigger('root')}>Actions</button>
      </MenuHost>,
    );
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    for (const char of 'close o') {
      key(char);
    }

    expect(close).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(item('Close other tabs'));
    act(() => {
      vi.advanceTimersByTime(701);
    });
    key(' ');
    expect(other).toHaveBeenCalledOnce();
  });

  it('moves focus by pages without wrapping past either end', () => {
    const entries = Array.from({ length: 12 }, (_, i) => action(String(i + 1), `Command ${i + 1}`));
    render(<MenuHost menus={{ root: entries }}><button {...menuTrigger('root')}>Actions</button></MenuHost>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    key('PageDown');
    expect(document.activeElement).toBe(item('Command 11'));
    key('PageDown');
    key('PageDown');
    expect(document.activeElement).toBe(item('Command 12'));
    key('PageUp');
    expect(document.activeElement).toBe(item('Command 2'));
    key('PageUp');
    key('PageUp');
    expect(document.activeElement).toBe(item('Command 1'));
  });

  it('restores focus before an action, ignores activation repeats, and does not take focus back from the action', () => {
    const run = vi.fn(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
      screen.getByRole('textbox').focus();
    });
    render(
      <MenuHost menus={{ actions: [action('edit', 'Edit', run)] }}>
        <button {...menuTrigger('actions')}>Actions</button>
        <input aria-label="Editor" />
      </MenuHost>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(fireEvent.click(trigger, { detail: 0 })).toBe(false);
    expect(document.activeElement).toBe(item('Edit'));
    expect(fireEvent.keyDown(item('Edit'), { key: 'Enter', repeat: true })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(key(' ')).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('renders groups, checks, radio choices, metadata, shortcuts and the active entry’s hint line', () => {
    function Settings() {
      const [check, setCheck] = useState<boolean | 'mixed'>('mixed');
      const [source, setSource] = useState('');
      const id = useMenu([
        { kind: 'separator', id: 'leading' },
        {
          kind: 'group', id: 'view', label: 'View', items: [{
            kind: 'checkbox', id: 'check', label: 'Show hidden', checked: check, onChange: setCheck,
            icon: 'eye', shortcut: '⌘H', metadata: { text: 'Two hidden', icon: 'folder-tree' },
            hints: [{ keys: '↵', spokenKeys: 'Enter', label: 'Change visibility' }],
          }],
        },
        { kind: 'separator', id: 'middle' },
        { kind: 'separator', id: 'duplicate' },
        { kind: 'radio', id: 'source', label: 'Source', value: source, onChange: setSource, options: [
          { id: '', label: 'All sources' }, { id: 'local', label: 'Local' },
        ] },
        { ...action('delete', 'Delete'), destructive: true },
        { kind: 'separator', id: 'trailing' },
      ]);
      return <button {...menuTrigger(id)}>Settings</button>;
    }

    render(<MenuHost><Settings /></MenuHost>);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const view = screen.getByRole('group', { name: 'View' });
    const checkbox = within(view).getByRole('menuitemcheckbox', { name: 'Show hidden' });
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.querySelector('[data-ov-glyph="minus"]')).not.toBeNull();
    expect(checkbox.querySelector('[data-ov-menu-metadata] [data-ov-glyph="folder-tree"]')).not.toBeNull();
    expect(checkbox.querySelector('kbd')?.textContent).toBe('⌘H');
    expect(checkbox.getAttribute('aria-description')).toBe('Two hidden; ⌘H; Enter: Change visibility');
    const footer = panel().querySelector('[data-ov-menu-footer]');
    expect(footer?.getAttribute('aria-hidden')).toBe('true');
    expect(footer?.firstElementChild?.querySelector('kbd')?.textContent).toBe('↵');
    expect(footer?.lastElementChild?.querySelector('kbd')?.textContent).toBe('↵');
    expect(footer?.lastElementChild?.textContent ?? '').toContain('Change visibility');
    const group = screen.getByRole('group', { name: 'Source' });
    expect(within(group).getByRole('menuitemradio', { name: 'All sources' }).getAttribute('aria-checked')).toBe('true');
    expect(within(group).getByRole('menuitemradio', { name: 'Local' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(item('Delete').getAttribute('aria-description')).toBe('Destructive action');
    expect(item('Delete').hasAttribute('data-ov-destructive')).toBe(true);

    key(' ');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Local' }));
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Local' }).getAttribute('aria-checked')).toBe('true');
    key('ArrowDown');
    expect(panel().querySelector('[data-ov-menu-footer]')?.lastElementChild?.textContent ?? '').not.toContain('Change visibility');
  });

  it('subscribes after showing the initial rows and resizes without replacing the focused button', () => {
    metrics().mockImplementation(function measure(this: Element) {
      return new DOMRect(0, 0, 200, 40 * this.querySelectorAll('[role="menuitem"]').length);
    });
    const stale = vi.fn();
    const unsubscribe = vi.fn();
    const selected = vi.fn(() => {
      expect(unsubscribe).toHaveBeenCalledExactlyOnceWith('keep');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
    const subscribe = vi.fn<MenuSource['subscribe']>(() => {
      expect(panel().getAttribute('data-ov-side')).toBe('bottom');
      expect(document.activeElement).toBe(panel());
      return unsubscribe;
    });
    const source: MenuSource = { items: [action('remove', 'Withdrawn', stale), action('keep', 'Keep', stale)], subscribe };
    render(
      <StrictMode>
        <MenuHost menus={{ actions: () => source }}>
          <button {...menuTrigger('actions', 'row', 'context')}>Actions</button>
        </MenuHost>
      </StrictMode>,
    );
    const trigger = screen.getByRole('button');
    expect(subscribe).not.toHaveBeenCalled();
    fireEvent.contextMenu(trigger, { button: 2, clientX: 100, clientY: 500 });
    expect(subscribe).toHaveBeenCalledOnce();
    const popup = panel();
    const keep = item('Keep');
    const removed = item('Withdrawn');
    fireEvent.pointerMove(keep, { pointerType: 'mouse' });
    expect(document.activeElement).toBe(keep);
    act(() => {
      subscribe.mock.calls[0]?.[0]([
        action('keep', 'Keep', selected), action('other', 'Other'), action('new', 'New'),
      ]);
      // The old React handler can still be mounted until this batch commits.
      removed.click();
    });
    expect(stale).not.toHaveBeenCalled();
    expect(panel()).toBe(popup);
    expect(popup.getAttribute('data-ov-side')).toBe('top');
    expect(popup.style.getPropertyValue('--_y')).toBe('380px');
    expect(item('Keep')).toBe(keep);
    expect(document.activeElement).toBe(keep);
    fireEvent.click(removed);
    expect(unsubscribe).not.toHaveBeenCalled();
    key('ArrowDown');
    expect(document.activeElement).toBe(item('Other'));
    key('ArrowUp');
    key('Enter');
    expect(selected).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  it('retains a focused submenu across a refresh by group and entry ID, not index', () => {
    const stale = vi.fn();
    const choose = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn<MenuSource['subscribe']>(() => unsubscribe);
    const group = (id: string, leaf: MenuAction, label = `${id} choices`): MenuItem => ({
      kind: 'group', id, items: [{ kind: 'submenu', id: 'more', label, items: [leaf] }],
    });
    const left = group('Left', action('leaf', 'Left item', stale));
    render(
      <MenuHost menus={{ actions: () => ({ items: [left, group('Right', action('leaf', 'Right item', stale))], subscribe }) }}>
        <button {...menuTrigger('actions')}>Actions</button>
      </MenuHost>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowUp' });
    key('ArrowRight');
    const focused = item('Right item');
    expect(document.activeElement).toBe(focused);
    act(() => {
      subscribe.mock.calls[0]?.[0]([group('Right', action('leaf', 'Renamed', choose), 'Updated choices'), left]);
    });
    expect(item('Renamed')).toBe(focused);
    expect(document.activeElement).toBe(focused);
    expect(panel('Updated choices').contains(focused)).toBe(true);
    expect(item('Updated choices').getAttribute('aria-expanded')).toBe('true');
    key('Escape');
    expect(document.activeElement).toBe(item('Updated choices'));
    expect(unsubscribe).not.toHaveBeenCalled();
    key('ArrowRight');
    fireEvent.click(item('Renamed'));
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith('leaf');
    expect(choose).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  it('honors pending pointer intent only while its submenu button survives an update', () => {
    vi.useFakeTimers();
    const branch: MenuItem = { kind: 'submenu', id: 'more', label: 'More', items: [action('child', 'Child')] };
    const subscribe = vi.fn<MenuSource['subscribe']>(() => vi.fn());
    render(
      <MenuHost menus={{ actions: () => ({ items: [branch], subscribe }) }}>
        <button {...menuTrigger('actions')}>Actions</button>
      </MenuHost>,
    );
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    const button = item('More');
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    act(() => {
      subscribe.mock.calls[0]?.[0]([action('first', 'First'), branch]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(panel('More').contains(item('Child'))).toBe(true);
    expect(document.activeElement).toBe(button);
    key('Escape');
    fireEvent.pointerMove(button, { pointerType: 'mouse' });
    act(() => {
      subscribe.mock.calls[0]?.[0]([action('first', 'First'), { ...branch, id: 'different', label: 'Replacement' }]);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getAllByRole('menu')).toEqual([panel('Actions')]);
    expect(document.activeElement).toBe(panel());
  });

  it('retires each source on replacement, null, Escape and host teardown; a late update cannot affect another opening', () => {
    const retire = vi.fn();
    const subscribe = vi.fn<MenuSource['subscribe']>(() => retire);
    function Triggers() {
      const id = useMenu((key) => ({ items: [action('native', key ?? 'Native')], subscribe }));
      return <>
        <button {...menuTrigger(id, 'First', 'context')}>A</button>
        <button {...menuTrigger(id, 'Second', 'context')}>B</button>
      </>;
    }

    const { unmount } = render(<MenuHost><Triggers /></MenuHost>);
    const first = screen.getByRole('button', { name: 'A' });
    const second = screen.getByRole('button', { name: 'B' });
    fireEvent.keyDown(first, { key: 'ContextMenu' });
    fireEvent.contextMenu(second, { button: 2 });
    expect(retire).toHaveBeenCalledExactlyOnceWith(undefined);
    act(() => {
      subscribe.mock.calls[0]?.[0]([action('old', 'Old')]);
      subscribe.mock.calls[0]?.[0](null);
    });
    expect(item('Second').isConnected).toBe(true);
    expect(screen.queryByRole('menuitem', { name: 'Old' })).toBeNull();
    act(() => {
      subscribe.mock.calls[1]?.[0](null);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(first, { key: 'ContextMenu' });
    key('Escape');
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(second, { key: 'ContextMenu' });
    unmount();
    expect(subscribe).toHaveBeenCalledTimes(4);
    expect(retire.mock.calls).toEqual([[undefined], [undefined], [undefined], [undefined]]);
  });

  it('releases a source that dismisses synchronously before subscribe returns', () => {
    const unsubscribe = vi.fn();
    const subscribe: MenuSource['subscribe'] = (update) => {
      update(null);
      update([action('stale', 'Stale')]);
      return unsubscribe;
    };

    render(
      <MenuHost menus={{ actions: () => ({ items: [action('first', 'First')], subscribe }) }}>
        <button {...menuTrigger('actions')}>Actions</button>
      </MenuHost>,
    );
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    expect(unsubscribe).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('updates a scoped registration for the next opening, not the visible snapshot', () => {
    function Local({ label }: { readonly label: string }) {
      const id = useMenu(() => [action('inspect', label)]);
      return <button {...menuTrigger(id)}>Actions</button>;
    }

    const { rerender } = render(<MenuHost><Local label="First" /></MenuHost>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(item('First'));
    rerender(<MenuHost><Local label="Second" /></MenuHost>);
    expect(document.activeElement).toBe(item('First'));
    expect(screen.queryByRole('menuitem', { name: 'Second' })).toBeNull();
    key('Escape');
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(item('Second'));
  });

  it('dismisses a scoped definition when its explicit revision changes', () => {
    function Local({ paused }: { readonly paused: boolean }) {
      const id = useMenu([action('toggle', paused ? 'Resume' : 'Pause')], paused);
      return <button {...menuTrigger(id)}>Actions</button>;
    }

    const { rerender } = render(<MenuHost><Local paused={false} /></MenuHost>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(item('Pause'));
    rerender(<MenuHost><Local paused={false} /></MenuHost>);
    expect(document.activeElement).toBe(item('Pause'));
    rerender(<MenuHost><Local paused={true} /></MenuHost>);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(item('Resume'));
  });

  it('anchors context invocation to a pointer or a keyboard target, without stealing native editor menus', () => {
    metrics();
    const resolve = vi.fn(() => [action('inspect', 'Inspect')]);
    render(
      <MenuHost menus={{ row: resolve }}>
        <div tabIndex={0} {...menuTrigger('row', 'one', 'context')} data-ov-menu-label="Row commands" data-testid="row">
          <span>Job one</span>
          <input aria-label="Custom name" />
        </div>
      </MenuHost>,
    );
    const trigger = screen.getByTestId('row');
    const editor = screen.getByRole('textbox');
    fireEvent.click(trigger);
    expect(fireEvent.contextMenu(editor, { button: 2 })).toBe(true);
    expect(fireEvent.keyDown(editor, { key: 'F10', shiftKey: true })).toBe(true);
    expect(resolve).not.toHaveBeenCalled();

    expect(fireEvent.contextMenu(screen.getByText('Job one'), { button: 2, clientX: 760, clientY: 540 })).toBe(false);
    expect(document.activeElement).toBe(panel('Row commands'));
    expect(panel().getAttribute('data-ov-side')).toBe('top');
    expect(panel().style.getPropertyValue('--_x')).toBe('560px');
    expect(panel().style.getPropertyValue('--_y')).toBe('420px');
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    key('Escape');
    expect(document.activeElement).toBe(trigger);

    expect(fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(item('Inspect'));
    expect(panel().getAttribute('data-ov-side')).toBe('bottom');
    expect(panel().style.getPropertyValue('--_x')).toBe('100px');
    expect(panel().style.getPropertyValue('--_y')).toBe('88px');
    expect(fireEvent.contextMenu(trigger, { button: 0 })).toBe(false);
    expect(resolve.mock.calls).toEqual([['one'], ['one']]);
    key('Escape');
    expect(fireEvent.keyDown(trigger, { key: 'ContextMenu' })).toBe(false);
    expect(document.activeElement).toBe(item('Inspect'));
  });

  it('opens and traverses nested branches, closing one level at a time with Escape or Back', () => {
    const run = vi.fn();
    const entries: readonly MenuItem[] = [{ kind: 'submenu', id: 'open', label: 'Open with', items: [
      { kind: 'submenu', id: 'local', label: 'Local tools', items: [action('edit', 'Edit file', run)] },
    ] }];
    render(<MenuHost menus={{ root: entries }}><button {...menuTrigger('root')}>Actions</button></MenuHost>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const branch = item('Open with');
    expect(branch.getAttribute('aria-expanded')).toBe('false');
    key('ArrowRight');
    expect(branch.getAttribute('aria-controls')).toBe(panel('Open with').id);
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(item('Local tools'));
    key('ArrowRight');
    expect(document.activeElement).toBe(item('Edit file'));
    expect(screen.getAllByRole('menu')).toHaveLength(3);
    key('ArrowLeft');
    expect(document.activeElement).toBe(item('Local tools'));
    expect(screen.getAllByRole('menu')).toHaveLength(2);
    key('Escape');
    expect(document.activeElement).toBe(branch);
    expect(branch.getAttribute('aria-expanded')).toBe('false');
    expect(branch.hasAttribute('aria-controls')).toBe(false);
    key('ArrowRight');
    key('ArrowRight');
    key('Enter');
    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the deepest hover-open level on Escape even when its parent still holds focus', () => {
    vi.useFakeTimers();
    const entries: readonly MenuItem[] = [{ kind: 'submenu', id: 'open', label: 'Open with', items: [
      { kind: 'submenu', id: 'local', label: 'Local tools', items: [action('edit', 'Edit file')] },
    ] }];
    render(<MenuHost menus={{ root: entries }}><button {...menuTrigger('root')}>Actions</button></MenuHost>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    key('ArrowRight');
    const parent = item('Local tools');
    fireEvent.pointerMove(parent, { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getAllByRole('menu')).toHaveLength(3);
    expect(document.activeElement).toBe(parent);

    key('Escape');
    expect(screen.getAllByRole('menu')).toHaveLength(2);
    expect(document.activeElement).toBe(parent);
    key('Escape');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(document.activeElement).toBe(item('Open with'));
  });

  it('keeps a menu in its themed overlay and reverses horizontal navigation in RTL', () => {
    const entries: readonly MenuItem[] = [
      { kind: 'submenu', id: 'open', label: 'Open with', items: [action('edit', 'Edit')] },
    ];
    render(
      <MenuHost menus={{ root: entries }}>
        <dialog open aria-label="Preferences" onKeyDown={(event) => {
          if (event.key === 'Escape') {
            throw new Error('Escape leaked out of the menu');
          }
        }}>
          <div data-ov-menu-scope="" data-ov-theme="light" dir="rtl" data-testid="scope">
            <button {...menuTrigger('root')}>Actions</button>
          </div>
        </dialog>
      </MenuHost>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(panel('Actions'))).toBe(true);
    expect(screen.getByTestId('scope').contains(panel('Actions'))).toBe(true);
    expect(panel('Actions').getAttribute('dir')).toBe('rtl');
    key('ArrowLeft');
    expect(dialog.contains(panel('Open with'))).toBe(true);
    expect(document.activeElement).toBe(item('Edit'));
    key('Escape');
    expect(document.activeElement).toBe(item('Open with'));
    key('Escape');
    expect(document.activeElement).toBe(trigger);
  });

  it('reuses its portal and keeps local fieldset theme and table density without invalid table children', () => {
    render(
      <MenuHost menus={{ root: [action('open', 'Open')] }}>
        <fieldset data-ov-theme="light"><button {...menuTrigger('root')}>Themed</button></fieldset>
        <div data-ov-menu-scope="" role="region" aria-label="Rows">
          <table data-ov-density="compact">
            <tbody><tr><td><button {...menuTrigger('root', 'a')}>Compact</button></td></tr></tbody>
          </table>
        </div>
      </MenuHost>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Themed' }));
    const portal = panel().parentElement;
    expect(portal?.hasAttribute('data-ov-menu-portal')).toBe(true);
    expect(portal?.getAttribute('data-ov-theme')).toBe('light');
    key('Escape');
    expect(portal?.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(panel().parentElement).toBe(portal);
    expect(portal?.getAttribute('data-ov-theme')).toBeNull();
    expect(portal?.getAttribute('data-ov-density')).toBe('compact');
    expect(screen.getByRole('region').contains(panel())).toBe(true);
    expect(screen.getByRole('table').contains(panel())).toBe(false);
  });

  it('makes a clipped label and metadata available through the focused row', () => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(40);
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(100);
    render(
      <MenuHost menus={{ root: [{ ...action('launch', 'Launch environment'), metadata: 'This computer' }] }}>
        <button {...menuTrigger('root')}>Actions</button>
      </MenuHost>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    const focused = item('Launch environment');
    expect(document.activeElement).toBe(focused);
    expect(focused.getAttribute('data-ov-tip')).toBe('Launch environment\nThis computer');
  });

  it('aligns a submenu’s first selectable row, including the group heading above it', () => {
    metrics();
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function offset(this: HTMLElement) {
      return this.textContent === 'Choice' ? 33 : 0;
    });
    const entries: readonly MenuItem[] = [
      { kind: 'submenu', id: 'pick', label: 'Pick', items: [
        { kind: 'group', id: 'group', label: 'Group', items: [action('choice', 'Choice')] },
      ] },
    ];
    render(<MenuHost menus={{ root: entries }}><button {...menuTrigger('root')}>Actions</button></MenuHost>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    key('ArrowRight');
    expect(panel('Pick').style.getPropertyValue('--_y')).toBe('26px');
    expect(document.activeElement).toBe(item('Choice'));
  });

  it('opens a hovered branch after brief intent, but not after moving away or from touch', () => {
    vi.useFakeTimers();
    const entries: readonly MenuItem[] = [
      { kind: 'submenu', id: 'open', label: 'Open with', items: [action('edit', 'Edit')] },
      action('copy', 'Copy'),
    ];
    render(<MenuHost menus={{ root: entries }}><button {...menuTrigger('root')}>Actions</button></MenuHost>);
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    fireEvent.pointerMove(item('Open with'), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    fireEvent.pointerMove(item('Open with'), { pointerType: 'mouse' });
    fireEvent.pointerMove(item('Copy'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(document.activeElement).toBe(item('Copy'));
    fireEvent.pointerMove(item('Open with'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(panel('Open with').isConnected).toBe(true);
    expect(document.activeElement).toBe(item('Open with'));
    key('ArrowLeft');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(document.activeElement).toBe(item('Open with'));
    fireEvent.pointerMove(item('Open with'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerMove(item('Edit'), { pointerType: 'mouse' });
    expect(document.activeElement).toBe(item('Edit'));
  });

  it('dismisses on Tab, outside press and external focus without swallowing the next interaction', () => {
    render(
      <MenuHost menus={{ root: [action('open', 'Open')] }}>
        <button {...menuTrigger('root')}>Actions</button>
        <button>Outside</button>
      </MenuHost>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    const outside = screen.getByRole('button', { name: 'Outside' });
    fireEvent.click(trigger);
    expect(key('Tab')).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(fireEvent.pointerDown(outside)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger);
    act(() => {
      outside.focus();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('preserves native shortcut routing through a marked region and closes when focus is lost', () => {
    render(
      <MenuHost menus={{ root: [action('open', 'Open')] }}>
        <div data-ov-menu-scope="" role="region" aria-label="Tool panel">
          <button {...menuTrigger('root')}>Actions</button>
        </div>
      </MenuHost>,
    );
    const region = screen.getByRole('region');
    const trigger = screen.getByRole('button');
    const shortcut = vi.fn();
    region.addEventListener('keydown', shortcut);
    fireEvent.click(trigger);
    expect(region.contains(panel())).toBe(true);
    const open = item('Open');
    fireEvent.keyDown(open, { key: 'w', metaKey: true });
    expect(shortcut).toHaveBeenCalledOnce();

    act(() => {
      open.blur();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
  });

  it('dismisses invokers hidden or made inert and refuses a stale activation while the DOM observer is pending', async () => {
    const run = vi.fn();
    const resolve = vi.fn(() => [action('inspect', 'Inspect', run)]);
    render(
      <MenuHost menus={{ root: resolve }}>
        <div role="region" tabIndex={0} aria-label="Rows">
          <div data-testid="content"><button {...menuTrigger('root', 'a')}>Actions</button></div>
        </div>
      </MenuHost>,
    );
    const trigger = screen.getByRole('button');
    const content = screen.getByTestId('content');
    fireEvent.click(trigger);
    const stale = item('Inspect');
    content.setAttribute('inert', '');
    fireEvent.click(stale);
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region'));
    fireEvent.click(trigger);
    expect(resolve).toHaveBeenCalledOnce();

    content.removeAttribute('inert');
    fireEvent.click(trigger);
    await act(async () => {
      content.hidden = true;
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region'));
  });

  it.each([false, true])('dismisses a moved overlay trigger (stale click before observer: %s)', async (activate) => {
    const run = vi.fn();
    render(
      <MenuHost menus={{ root: [action('inspect', 'Inspect', run)] }}>
        <dialog open aria-label="Original dialog">
          <div role="region" tabIndex={0} aria-label="Original region">
            <button {...menuTrigger('root')}>Actions</button>
          </div>
        </dialog>
        <dialog open aria-label="Other dialog" />
      </MenuHost>,
    );
    const original = screen.getByRole('dialog', { name: 'Original dialog' });
    const region = screen.getByRole('region', { name: 'Original region' });
    const other = screen.getByRole('dialog', { name: 'Other dialog' });
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    const stale = item('Inspect');
    expect(original.contains(stale)).toBe(true);

    await act(async () => {
      other.append(trigger);
      if (activate) {
        fireEvent.click(stale);
        expect(run).not.toHaveBeenCalled();
      }
    });

    expect(other.contains(trigger)).toBe(true);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(region);
  });

  it.each([false, true])('dismisses a page trigger moved into a closed dialog (stale click before observer: %s)', async (activate) => {
    const run = vi.fn();
    const resolve = vi.fn(() => [action('inspect', 'Inspect', run)]);
    render(
      <MenuHost menus={{ root: resolve }}>
        <div role="region" tabIndex={0} aria-label="Page">
          <button {...menuTrigger('root')}>Actions</button>
        </div>
        <dialog data-testid="closed-dialog" />
      </MenuHost>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    const closedDialog = screen.getByTestId('closed-dialog');
    fireEvent.click(trigger);
    const stale = item('Inspect');
    await act(async () => {
      closedDialog.append(trigger);
      if (activate) {
        fireEvent.click(stale);
        expect(run).not.toHaveBeenCalled();
      }
    });

    expect(trigger.isConnected).toBe(true);
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Page' }));
    expect(fireEvent.click(trigger)).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it('dismisses a dialog menu when its containing dialog loses the open attribute', async () => {
    render(
      <MenuHost menus={{ root: [action('inspect', 'Inspect')] }}>
        <dialog open aria-label="Settings"><button {...menuTrigger('root')}>Actions</button></dialog>
      </MenuHost>,
    );
    const dialog = screen.getByRole('dialog');
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(dialog.contains(panel())).toBe(true);
    await act(async () => {
      dialog.removeAttribute('open');
    });

    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(dialog.querySelector('[data-ov-menu-popup]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('dismisses a fieldset-disabled trigger but keeps the first legend trigger enabled', async () => {
    const run = vi.fn();
    render(
      <MenuHost menus={{ root: [action('inspect', 'Inspect', run)] }}>
        <div role="region" tabIndex={0} aria-label="Original region">
          <fieldset data-testid="settings">
            <legend><button {...menuTrigger('root')}>Legend actions</button></legend>
            <button {...menuTrigger('root')}>Field actions</button>
          </fieldset>
        </div>
      </MenuHost>,
    );
    const fieldset = screen.getByTestId('settings');
    const legend = screen.getByRole('button', { name: 'Legend actions' });
    const field = screen.getByRole('button', { name: 'Field actions' });
    fireEvent.click(field);
    expect(panel('Field actions').isConnected).toBe(true);
    await act(async () => {
      fieldset.setAttribute('disabled', '');
    });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(field.hasAttribute('aria-expanded')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('region'));

    fieldset.removeAttribute('disabled');
    fireEvent.click(legend);
    await act(async () => {
      fieldset.setAttribute('disabled', '');
    });

    expect(panel('Legend actions').isConnected).toBe(true);
    key('Enter');
    expect(run).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(legend);
  });

  it('rejects a recycled trigger before an observer can run and restores only the original region', () => {
    const run = vi.fn();
    const resolve = (id: string | undefined) => [action(id ?? 'empty', `Inspect ${id}`, () => {
      run(id);
    })];
    function Table({ id }: { readonly id: string }) {
      return (
        <MenuHost menus={{ row: resolve }}>
          <div role="region" tabIndex={0} aria-label="Jobs">
            <table><tbody><tr tabIndex={-1}><td><button {...menuTrigger('row', id)}>Actions</button></td></tr></tbody></table>
          </div>
        </MenuHost>
      );
    }

    const { rerender } = render(<Table id="a" />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    const old = item('Inspect a');
    rerender(<Table id="b" />);
    expect(screen.getByRole('button', { name: 'Actions' })).toBe(trigger);
    fireEvent.click(old);
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('region'));
    fireEvent.click(trigger);
    fireEvent.click(item('Inspect b'));
    expect(run).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('waits for virtual layout before returning focus after a scroll', () => {
    render(
      <MenuHost menus={{ row: [action('inspect', 'Inspect')] }}>
        <div role="region" tabIndex={0} aria-label="Jobs">
          <button {...menuTrigger('row', 'a')}>Actions</button>
        </div>
      </MenuHost>,
    );
    const trigger = screen.getByRole('button');
    const region = screen.getByRole('region');
    fireEvent.click(trigger);
    let frame: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    fireEvent.scroll(region);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    trigger.setAttribute('data-ov-menu-key', 'b');
    expect(request).toHaveBeenCalledOnce();
    act(() => {
      frame?.(0);
    });
    expect(document.activeElement).toBe(region);
  });

  it('dismisses on a key mutation or disconnection without restoring a replaced trigger', async () => {
    const resolve = (id: string | undefined) => [action(id ?? 'empty', `Inspect ${id}`)];
    function Rows({ show }: { readonly show: boolean }) {
      return (
        <MenuHost menus={{ row: resolve }}>
          <div role="region" tabIndex={0} aria-label="Jobs">
            {show ? <button key="a" {...menuTrigger('row', 'a')}>Actions A</button> : <button key="b" {...menuTrigger('row', 'b')}>Actions B</button>}
          </div>
        </MenuHost>
      );
    }

    const { rerender } = render(<Rows show={true} />);
    const first = screen.getByRole('button');
    fireEvent.click(first);
    await act(async () => {
      first.setAttribute('data-ov-menu-key', 'recycled');
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region'));

    fireEvent.click(first);
    await act(async () => {
      rerender(<Rows show={false} />);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('region'));
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Actions B' }));
  });
});
