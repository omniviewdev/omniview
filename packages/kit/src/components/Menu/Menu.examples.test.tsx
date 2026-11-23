import { MenuHost } from '@omniviewdev/kit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as examples from './Menu.examples';

let popoverRule: HTMLStyleElement;
beforeEach(() => {
  const size = (element: Element, viewport: number, region: number) =>
    element === document.documentElement ? viewport : element.getAttribute('role') === 'region' ? region : 0;
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function height(this: Element) {
    return size(this, 900, 420);
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function width(this: Element) {
    return size(this, 1440, 480);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
});

afterEach(() => {
  popoverRule.remove();
  vi.restoreAllMocks();
});

function renderExample(name: keyof typeof examples) {
  const Example = examples[name];
  return render(<MenuHost><Example /></MenuHost>);
}

function press(key: string, init?: KeyboardEventInit) {
  fireEvent.keyDown(document.activeElement ?? document.body, { ...init, key });
}

function open(name: string) {
  const trigger = screen.getByRole('button', { name });
  trigger.focus();
  fireEvent.click(trigger, { detail: 1 });
  return trigger;
}

const menu = () => screen.getByRole('menu');

it('uses one root for the examples, and replaces a dropdown when a context menu opens', () => {
  render(<MenuHost><examples.WorkspaceOverflow /><examples.TabContext /></MenuHost>);
  expect(screen.queryByRole('menu')).toBeNull();
  const more = open('Workspace actions');
  expect(more.getAttribute('aria-controls')).toBe(menu().id);
  expect(within(menu()).getByRole('menuitem', { name: 'Organize folders…' }).getAttribute('aria-disabled')).toBe('true');
  const tab = screen.getByRole('button', { name: 'Nodes' });
  fireEvent.contextMenu(tab, { button: 2, clientX: 100, clientY: 100 });
  expect(more.hasAttribute('aria-expanded')).toBe(false);
  expect(screen.getByRole('menu', { name: 'Actions for Nodes' })).toBe(menu());
  fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Duplicate tab' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByText('Last action: Duplicate tab: Nodes')).toBeDefined();
});

it('opens a terminal submenu by keyboard and selects its specific target', () => {
  renderExample('TerminalTargets');
  const trigger = open('Terminal targets');
  expect(within(menu()).getByRole('group', { name: 'Recent' }).textContent).toContain('This computer');
  press('End');
  press('ArrowRight');
  expect(screen.getAllByRole('menu')).toHaveLength(2);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'app' }));
  press('Enter');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByText('Last action: Open ingress / app')).toBeDefined();
  expect(document.activeElement).toBe(trigger);
});

it('opens the tab context menu with Shift+F10 and restores focus to that tab', () => {
  renderExample('TabContext');
  const tab = screen.getByRole('button', { name: 'Connections' });
  tab.focus();
  press('F10', { shiftKey: true });
  expect(screen.getByRole('menu', { name: 'Actions for Connections' })).toBe(menu());
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'New tab to the right' }));
  press('Escape');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(tab);
});

it('focuses Quick view on pointer open and leaves removal as a separate destructive action', () => {
  renderExample('ConnectionActions');
  open('Actions for prod-eu');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Quick view' }));
  const destructive = within(menu()).getByRole('menuitem', { name: 'Remove connection…' });
  // Testing Library's description algorithm does not read aria-description.
  expect(destructive.getAttribute('aria-description')).toBe('Destructive action');
  expect(destructive.previousElementSibling?.getAttribute('role')).toBe('separator');
  fireEvent.click(destructive);
  expect(screen.getByText('Last action: Remove connection…: prod-eu')).toBeDefined();
});

it('updates mixed checkbox and radio state between openings', () => {
  renderExample('ViewOptions');
  const showStatus = () => within(menu()).getByRole('menuitemcheckbox', { name: 'Show status' });
  const sortByName = () => within(menu()).getByRole('menuitemradio', { name: 'Name' });
  open('View options');
  expect(showStatus().getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(showStatus());
  open('View options');
  expect(showStatus().getAttribute('aria-checked')).toBe('true');
  expect(sortByName().getAttribute('aria-checked')).toBe('false');
  fireEvent.click(sortByName());
  open('View options');
  expect(sortByName().getAttribute('aria-checked')).toBe('true');
  expect(screen.getByText('Last action: Show status; sort by name')).toBeDefined();
});

describe.each([
  { name: 'SmallRows', rows: 12, disabled: false },
  { name: 'TwoLineRows', rows: 12, disabled: true },
  { name: 'VirtualRows', rows: 20_000, disabled: false },
] as const)('$name table', ({ name, rows, disabled }) => {
  it('mounts one stateless trigger per visible row and resolves the clicked row', () => {
    const { container } = renderExample(name);
    expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe(String(rows + 1));
    const mounted = container.querySelectorAll('tbody > tr:not([aria-hidden])');
    const triggers = screen.getAllByRole('button', { name: /^Actions for worker-/ });
    expect(triggers).toHaveLength(mounted.length);
    if (rows === 20_000) {
      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThan(60);
    } else {
      expect(mounted).toHaveLength(rows);
    }

    for (const trigger of triggers) {
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.hasAttribute('title')).toBe(false);
      expect(trigger.hasAttribute('aria-expanded')).toBe(false);
      expect(trigger.onclick).toBeNull();
    }

    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = open('Actions for worker-2');
    expect(screen.getByRole('menu', { name: 'Workload actions' })).toBe(menu());
    expect(within(menu()).getAllByRole('menuitem').some((item) => item.getAttribute('aria-disabled') === 'true')).toBe(disabled);
    const destructive = within(menu()).getByRole('menuitem', { name: 'Delete…' });
    expect(destructive.getAttribute('aria-description')).toBe('Destructive action');
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Inspect' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('Last action: inspect worker-2')).toBeDefined();
    expect(document.activeElement).toBe(trigger);
  });
});
