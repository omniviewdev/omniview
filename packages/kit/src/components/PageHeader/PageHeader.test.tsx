import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { PageHeader, type PageHeaderProps } from './PageHeader';
import * as examples from './PageHeader.examples';

const header = (props: Partial<PageHeaderProps> = {}) => <PageHeader title="orders-api" {...props} />;
const noop = () => undefined;
const command = (id: string, label: string, rest: Record<string, unknown> = {}) => ({ id, label, onSelect: noop, ...rest });
const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const nameOf = (element: Element) => element.getAttribute('aria-label') ?? element.textContent;

describe('PageHeader, the title (design 12 PH1)', () => {
  it('is a header whose one h1 is the title, a tab target for a script and not a tab stop', () => {
    const { container } = render(header());
    expect(root(container).tagName).toBe('HEADER');
    const title = screen.getByRole('heading', { level: 1, name: 'orders-api' });
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(title.hasAttribute('data-ov-clip')).toBe(true);
  });

  it('puts the secondary run in the same heading, muted, after a space', () => {
    render(header({ subtitle: 'checkout' }));
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe('orders-api checkout');
    expect(title.querySelector('span')?.textContent).toBe('checkout');
  });

  it('is a lower level for a specimen, with no tab target: a page has exactly one h1', () => {
    for (const level of [2, 3, 4] as const) {
      const { unmount } = render(header({ level }));
      expect(screen.getByRole('heading', { level }).hasAttribute('tabindex')).toBe(false);
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      unmount();
    }
  });

  it('refuses a header with no title: a header with no h1 is a defect', () => {
    expect(() => render(header({ title: '   ' }))).toThrow(TypeError);
  });
});

describe('PageHeader, the breadcrumb (design 12 PH3)', () => {
  it('is a named navigation holding the path, whose last part is the page', () => {
    const select = vi.fn();
    render(header({ path: [{ label: 'Acme', onSelect: select }, { label: 'Items', onSelect: noop }, { label: 'orders-api' }] }));
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const crumbs = within(nav).getAllByRole('listitem');
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(['Acme', 'Items', 'orders-api']);
    expect(within(nav).getByText('orders-api').getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(nav).getByRole('button', { name: 'Acme' }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('draws a link only for a part that has somewhere to go, and a chevron only between parts, hidden from assistive technology', () => {
    render(header({ path: [{ label: 'Acme', onSelect: noop }, { label: 'Items' }, { label: 'orders-api' }] }));
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Acme']);
    const glyphs = nav.querySelectorAll('svg');
    expect(glyphs).toHaveLength(2);
    for (const glyph of glyphs) {
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
      expect(glyph.getAttribute('data-ov-glyph')).toBe('chevron-right');
      expect(glyph.getAttribute('data-ov-size')).toBe('12');
    }
  });

  it('is not there without a path', () => {
    render(header());
    expect(screen.queryByRole('navigation')).toBeNull();
    render(header({ path: [] }));
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('PageHeader, the kind tile (design 13 GL1)', () => {
  it('draws the tile of the kind before the title, decorative, 20 px', () => {
    const { container } = render(header({ tile: { icon: 'box', tone: 'blue' } }));
    const tile = container.querySelector('[data-ov-header-tile]');
    expect(tile).not.toBeNull();
    expect(tile?.getAttribute('aria-hidden')).toBe('true');
    expect(tile?.getAttribute('data-ov-tone')).toBe('blue');
    expect(tile?.getAttribute('data-ov-size')).toBe('20');
    expect(tile?.compareDocumentPosition(screen.getByRole('heading')) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(root(container).querySelector('[data-ov-tile]')).not.toBeNull();
  });

  it('is not there without one', () => {
    const { container } = render(header());
    expect(container.querySelector('[data-ov-header-tile]')).toBeNull();
  });
});

describe('PageHeader, the identity line (design 12 PH3, FS1)', () => {
  it('is not drawn when there is no state, no fact, no reason and no note: no empty band', () => {
    const { container } = render(header({ commands: { utility: command('refresh', 'Refresh items') } }));
    expect(container.querySelector('[data-ov-meta]')).toBeNull();
  });

  it('starts with the state: the glyph and the word of its role, in a chip', () => {
    const { container } = render(header({ state: { role: 'running', label: 'Running' }, facts: [{ text: 'Deployment' }] }));
    const meta = container.querySelector<HTMLElement>('[data-ov-meta]')!;
    expect(meta.firstElementChild?.getAttribute('data-ov-state-chip')).toBe('');
    expect(within(meta).getByText('Running').closest('[data-ov-role]')?.getAttribute('data-ov-role')).toBe('running');
  });

  it('keeps a progress state that waits to start as the clock, not the loader', () => {
    const { container } = render(header({ state: { role: 'progress', label: 'Pending', queued: true } }));
    expect(container.querySelector('[data-ov-glyph="clock"]')).not.toBeNull();
  });

  it('lists the facts in order, at most four, the text of each cut by an ellipsis when it does not fit', () => {
    const facts = ['a', 'b', 'c', 'd', 'e'].map((text) => ({ text }));
    const { container } = render(header({ facts }));
    const drawn = [...container.querySelectorAll('[data-ov-fact]')];
    expect(drawn.map((fact) => fact.textContent)).toEqual(['a', 'b', 'c', 'd']);
    for (const fact of drawn) {
      expect(fact.querySelector('[data-ov-clip]')).not.toBeNull();
    }
  });

  it('draws a mono fact in the code face, and a glyph before it', () => {
    const { container } = render(header({ facts: [{ text: 'i-0a1b2c3d', mono: true, icon: 'server' }] }));
    const fact = container.querySelector<HTMLElement>('[data-ov-fact]')!;
    expect(fact.getAttribute('data-ov-mono')).toBe('');
    expect(fact.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('server');
  });

  it('gives a fact a Copy button, named for what it copies, that calls onCopy and stays whole when the text is cut', () => {
    const onCopy = vi.fn();
    render(header({ facts: [{ text: 'i-0a1b2c3d', copy: { label: 'id', onCopy } }] }));
    const copy = screen.getByRole('button', { name: 'Copy id' });
    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('is one plain note instead of facts when it is given a note, 16 px and not 28', () => {
    const { container } = render(header({ note: 'Name and group · step 1 of 3' }));
    const meta = container.querySelector<HTMLElement>('[data-ov-meta]')!;
    expect(meta.textContent).toBe('Name and group · step 1 of 3');
    expect(meta.getAttribute('data-ov-line')).toBe('plain');
  });

  it('is the 28 px line, never plain, as soon as it holds a state or a fact', () => {
    const { container } = render(header({ state: { role: 'healthy', label: 'Ready' } }));
    expect(container.querySelector<HTMLElement>('[data-ov-meta]')!.hasAttribute('data-ov-line')).toBe(false);
  });
});

describe('PageHeader, the commands (design 12 PH2)', () => {
  let popoverRule: HTMLStyleElement;

  beforeEach(() => {
    // jsdom's default stylesheet hides every popover that is not `:popover-open`, a state it cannot match, so nothing in the overflow menu could be
    // found by role. A browser shows the popover once showPopover has run: this is the same rule, in the page (as RowMenu.test.tsx does).
    popoverRule = document.createElement('style');
    popoverRule.textContent = '[popover] { display: block; }';
    document.head.append(popoverRule);
  });

  afterEach(() => {
    popoverRule.remove();
  });

  const full: PageHeaderProps['commands'] = {
    primary: command('scale', 'Scale', { icon: 'box' }),
    secondary: [command('edit', 'Edit'), command('restart', 'Restart')],
    danger: command('delete', 'Delete'),
    utility: command('refresh', 'Refresh items'),
    menu: [{ id: 'labels', label: 'Edit labels', onSelect: noop }],
  };

  it('is one named group, "<title> commands" unless it is given a name', () => {
    const { rerender } = render(header({ commands: full }));
    expect(screen.getByRole('group', { name: 'orders-api commands' })).toBeTruthy();
    rerender(header({ commands: full, label: 'Deployment commands' }));
    expect(screen.getByRole('group', { name: 'Deployment commands' })).toBeTruthy();
  });

  it('is not drawn when there is no command at all', () => {
    render(header());
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('draws the commands in the one fixed order: primary, secondaries, danger, utility, overflow last', () => {
    render(header({ commands: full }));
    const lane = screen.getByRole('group', { name: 'orders-api commands' });
    expect(within(lane).getAllByRole('button').map(nameOf)).toEqual(['Scale', 'Edit', 'Restart', 'Delete', 'Refresh items', 'More actions for orders-api']);
  });

  it('paints the primary filled, the secondaries bordered, the danger bordered with a red label and never filled', () => {
    render(header({ commands: full }));
    const attribute = (name: string, key: string) => screen.getByRole('button', { name }).getAttribute(key);
    expect(attribute('Scale', 'data-ov-variant')).toBe('primary');
    expect(attribute('Edit', 'data-ov-variant')).toBe('secondary');
    expect(attribute('Restart', 'data-ov-variant')).toBe('secondary');
    expect(attribute('Delete', 'data-ov-variant')).toBe('secondary');
    expect(attribute('Delete', 'data-ov-tone')).toBe('danger');
    expect(attribute('Edit', 'data-ov-tone')).toBe('neutral');
  });

  it('draws at most two secondaries, and moves the rest into the overflow menu', () => {
    const select = vi.fn();
    render(header({ commands: { secondary: [command('a', 'Alpha'), command('b', 'Beta'), { id: 'c', label: 'Gamma', onSelect: select }] } }));
    const lane = screen.getByRole('group', { name: 'orders-api commands' });
    expect(within(lane).getAllByRole('button').map(nameOf)).toEqual(['Alpha', 'Beta', 'More actions for orders-api']);
    fireEvent.click(screen.getByRole('button', { name: 'More actions for orders-api' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('calls the command that was chosen', () => {
    const select = vi.fn();
    render(header({ commands: { primary: { id: 'scale', label: 'Scale', onSelect: select } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Scale' }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('draws a primary\'s glyph before its label, and the label names it', () => {
    render(header({ commands: { primary: command('scale', 'Scale', { icon: 'box' }) } }));
    const button = screen.getByRole('button', { name: 'Scale' });
    expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('box');
  });

  describe('the utility', () => {
    it('is one icon-only command named by its own label, with the refresh glyph unless it has another', () => {
      const { rerender } = render(header({ commands: { utility: command('refresh', 'Refresh items') } }));
      const button = screen.getByRole('button', { name: 'Refresh items' });
      expect(button.textContent).toBe('');
      expect(button.getAttribute('data-ov-shape')).toBe('icon');
      expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('refresh');
      expect(button.getAttribute('data-ov-tip')).toBe('Refresh items');
      rerender(header({ commands: { utility: command('copy', 'Copy list', { icon: 'copy' }) } }));
      expect(screen.getByRole('button', { name: 'Copy list' }).querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('copy');
    });

    it('stays focusable while it cannot be used, and does nothing, with its reason described (design 14 P2)', () => {
      const select = vi.fn();
      render(header({ commands: { utility: { id: 'refresh', label: 'Refresh items', onSelect: select, disabledReason: 'Refreshing' } } }));
      const button = screen.getByRole('button', { name: 'Refresh items' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
      fireEvent.click(button);
      expect(select).not.toHaveBeenCalled();
    });

    it('does not make an identity line of its reason: it would move the page below when the reason comes and goes', () => {
      const { container } = render(header({ commands: { utility: { id: 'refresh', label: 'Refresh items', onSelect: noop, disabledReason: 'Refreshing' } } }));
      expect(container.querySelector('[data-ov-meta]')).toBeNull();
    });

    it('says it is busy at once', () => {
      render(header({ commands: { utility: { id: 'refresh', label: 'Refresh items', onSelect: noop, busy: true } } }));
      expect(screen.getByRole('button', { name: 'Refresh items' }).getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('a command that cannot be used (design 14 P2, 04 DR1)', () => {
    it('keeps its button and writes the first reason in the identity line as muted text, where it is read', () => {
      const { container } = render(
        header({
          commands: {
            primary: command('scale', 'Scale', { disabledReason: 'Another change is running' }),
            secondary: [command('edit', 'Edit', { disabledReason: 'Not allowed' })],
          },
        }),
      );
      expect(screen.getByRole('button', { name: 'Scale' }).getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-disabled')).toBe('true');
      const meta = container.querySelector<HTMLElement>('[data-ov-meta]')!;
      expect(meta.querySelector('[data-ov-reason]')?.textContent).toBe('Another change is running');
    });

    it('takes the reason of the danger command too, after the others', () => {
      const { container } = render(header({ commands: { danger: command('delete', 'Delete', { disabledReason: 'Protected' }) } }));
      expect(container.querySelector('[data-ov-reason]')?.textContent).toBe('Protected');
    });
  });

  describe('the overflow menu (design 14 PX1)', () => {
    it('is the last control, a button that names its page, says it opens a menu, and has the tip of its name', () => {
      render(header({ commands: full }));
      const trigger = screen.getByRole('button', { name: 'More actions for orders-api' });
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('data-ov-tip')).toBe('More actions for orders-api');
      expect(trigger.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('ellipsis');
      const lane = screen.getByRole('group', { name: 'orders-api commands' });
      expect(within(lane).getAllByRole('button').at(-1)).toBe(trigger);
    });

    it('opens a menu named for the page, with its items, and calls the one that is chosen', () => {
      const select = vi.fn();
      render(header({ commands: { menu: [{ id: 'labels', label: 'Edit labels', onSelect: select }, { id: 'copy', label: 'Copy name', onSelect: noop }] } }));
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'More actions for orders-api' }));
      const menu = screen.getByRole('menu', { name: 'Actions for orders-api' });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit labels', 'Copy name']);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit labels' }));
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('never repeats a command that is a button: an item with the id of a visible command is left out', () => {
      render(header({ commands: { primary: command('scale', 'Scale'), menu: [{ id: 'scale', label: 'Scale', onSelect: noop }, { id: 'labels', label: 'Edit labels', onSelect: noop }] } }));
      fireEvent.click(screen.getByRole('button', { name: 'More actions for orders-api' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit labels']);
    });

    it('puts the destructive items last behind one separator', () => {
      render(header({ commands: { menu: [{ id: 'delete', label: 'Delete', destructive: true, onSelect: noop }, { id: 'labels', label: 'Edit labels', onSelect: noop }] } }));
      fireEvent.click(screen.getByRole('button', { name: 'More actions for orders-api' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit labels', 'Delete']);
      expect(screen.getAllByRole('separator')).toHaveLength(1);
    });

    it('is not drawn when no item is left: a trigger that opens nothing is not a control', () => {
      render(header({ commands: { primary: command('scale', 'Scale'), menu: [{ id: 'scale', label: 'Scale', onSelect: noop }] } }));
      expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    });

    it('opens from the keyboard on ArrowDown and closes on Escape with the focus back on the trigger', () => {
      render(header({ commands: { menu: [{ id: 'labels', label: 'Edit labels', onSelect: noop }] } }));
      const trigger = screen.getByRole('button', { name: 'More actions for orders-api' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      const menu = screen.getByRole('menu');
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('is in the tab order exactly once for each control, in reading order', () => {
    const { container } = render(header({ commands: full, facts: [{ text: 'i-0a1b', copy: { label: 'id', onCopy: noop } }], path: [{ label: 'Acme', onSelect: noop }, { label: 'orders-api' }] }));
    const stops = [...container.querySelectorAll<HTMLElement>('button, [tabindex]')].filter((element) => element.getAttribute('tabindex') !== '-1');
    expect(stops.map(nameOf)).toEqual(['Acme', 'Copy id', 'Scale', 'Edit', 'Restart', 'Delete', 'Refresh items', 'More actions for orders-api']);
  });
});

describe('PageHeader, the lane beside or under the title', () => {
  const lane = (props: Partial<PageHeaderProps>) => {
    const { container, unmount } = render(header(props));
    const mode = root(container).getAttribute('data-ov-lane');
    unmount();
    return mode;
  };

  it('is short for three controls or fewer, beside for a lane that fits one row, and default for a long one', () => {
    expect(lane({ commands: { utility: command('refresh', 'Refresh items') } })).toBe('short');
    const many = { primary: command('scale', 'Scale'), secondary: [command('edit', 'Edit'), command('restart', 'Restart')], danger: command('delete', 'Delete'), utility: command('refresh', 'Refresh items'), menu: [{ id: 'x', label: 'X', onSelect: noop }] };
    expect(lane({ commands: many })).toBe('beside');
    expect(lane({ title: 'a-deployment-name-that-is-much-too-long-for-the-room-its-commands-leave-it', commands: many })).toBe('default');
  });
});

describe('PageHeader, the operation slot (design 05 OF2, 12 PH2)', () => {
  const operation = { title: 'Scale orders-api', state: 'running', text: 'Scaling orders-api', progress: 0.4 } as const;

  it('has no slot when it is not given an operation, so a header with none has no gap and no anchor', () => {
    const { container } = render(header({ state: { role: 'running', label: 'Running' } }));
    expect(container.querySelector('[data-ov-slot]')).toBeNull();
  });

  it('has the slot, with no content and no width, when it is given null: it is the anchor of the line, empty at rest', () => {
    const { container } = render(header({ state: { role: 'running', label: 'Running' }, operation: null }));
    const slot = container.querySelector<HTMLElement>('[data-ov-slot]')!;
    expect(slot).not.toBeNull();
    expect(slot.children).toHaveLength(0);
    expect(slot.hasAttribute('data-ov-open')).toBe(false);
  });

  it('shows the presenter of a record in the slot, which is the last cell of the identity line', () => {
    const { container } = render(header({ state: { role: 'running', label: 'Running' }, facts: [{ text: 'Deployment' }], operation }));
    const meta = container.querySelector<HTMLElement>('[data-ov-meta]')!;
    const slot = meta.lastElementChild as HTMLElement;
    expect(slot.hasAttribute('data-ov-slot')).toBe(true);
    expect(slot.getAttribute('data-ov-open')).toBe('');
    expect(within(slot).getByRole('article', { name: 'Info: Scale orders-api' })).toBeTruthy();
    expect(meta.getAttribute('data-ov-op')).toBe('');
  });

  it('puts the slot in the title row, between the title and the commands, when there is no identity line', () => {
    const { container } = render(header({ commands: { utility: command('refresh', 'Refresh items') }, operation: null }));
    const row = root(container).querySelector<HTMLElement>('[data-ov-row]')!;
    expect(row.hasAttribute('data-ov-slot-row')).toBe(true);
    const parts = [...row.children].map((child) => child.getAttribute('data-ov-slot') === null ? child.tagName : 'slot');
    expect(parts).toEqual(['H1', 'slot', 'DIV']);
  });

  it('keeps the slot after the reason in the identity line', () => {
    const { container } = render(header({ commands: { primary: command('scale', 'Scale', { disabledReason: 'Busy' }) }, state: { role: 'running', label: 'Running' }, operation }));
    const meta = container.querySelector<HTMLElement>('[data-ov-meta]')!;
    expect([...meta.children].map((child) => child.getAttribute('data-ov-slot') === null ? child.hasAttribute('data-ov-reason') ? 'reason' : 'other' : 'slot')).toEqual(['other', 'reason', 'slot']);
  });
});

describe('PageHeader, props and counts', () => {
  it('passes data attributes to the header and nothing else, and carries no title or inline style', () => {
    const { container } = render(header({ 'data-testid': 'head', commands: { utility: command('refresh', 'Refresh items') } }));
    expect(screen.getByTestId('head')).toBe(root(container));
    expect(container.querySelector('[title], [style]')).toBeNull();
  });

  it('is a handful of elements: the list header is the title and one command', () => {
    // header, row, h1, group, button, svg, path
    const { container } = render(header({ commands: { utility: command('refresh', 'Refresh items') } }));
    expect(container.querySelectorAll('*')).toHaveLength(7);
  });
});

describe('the examples of PageHeader', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for each configuration the design names', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['Detail', 'DetailLong', 'DisabledReason', 'List', 'ListWithCreate', 'Note', 'OperationFailed', 'OperationLive', 'OperationRest', 'OperationRunning', 'OperationSucceeded'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} as a header with one h1 and no title attribute or inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(container.querySelector('[title]')).toBeNull();
      expect(container.querySelector('header')).not.toBeNull();
    });
  }
});

const css = await readFile(path.join(import.meta.dirname, 'PageHeader.module.css'), 'utf8');
// The rules that apply whatever the page's width: a rule inside a container query is read through `inContainer`.
const rule = (selector: string): Readonly<Record<string, string>> => {
  const matching = cssRules(css).filter((entry) => entry.selector.split(/\s*,\s*/).includes(selector) && !entry.context.some((context) => context.startsWith('@container')));
  if (matching.length === 0) {
    throw new Error(`no rule for the selector ${selector}`);
  }

  return Object.assign({}, ...matching.map((entry) => entry.declarations)) as Record<string, string>;
};

const inContainer = (selector: string, query: string) => declarationsOf(css, selector, query);

describe('the PageHeader stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is its own container, so the page\'s width decides where the lane sits, not the window\'s', () => {
    const root = rule('.root');
    expect(root['container-type']).toBe('inline-size');
    expect(root.display).toBe('grid');
    expect(root.gap).toBe('var(--ov-spacing-8)');
    expect(root['min-width']).toBe('0');
    expect(root.margin).toBe('0');
  });

  it('lays the title row out on a grid: title and commands, and a tile before them, 12 px apart, 4 px from the identity line', () => {
    expect(rule('.row')).toMatchObject({ display: 'grid', 'grid-template-columns': 'minmax(0, 1fr) auto', 'align-items': 'start', 'column-gap': 'var(--ov-spacing-12)', 'row-gap': 'var(--ov-spacing-4)', 'min-width': '0' });
    expect(rule('.row[data-ov-tile]')['grid-template-columns']).toBe('auto minmax(0, 1fr) auto');
    expect(rule('.row[data-ov-slot-row]')['grid-template-columns']).toBe('minmax(0, 1fr) auto auto');
    expect(rule('.row[data-ov-tile][data-ov-slot-row]')['grid-template-columns']).toBe('auto minmax(0, 1fr) auto auto');
  });

  it('is the 18/24 semibold title with 2 px of block padding, on one line with an ellipsis', () => {
    expect(rule('.title')).toMatchObject({
      'font-size': 'var(--ov-fs-18)',
      'line-height': 'var(--ov-lh-24)',
      'font-weight': '600',
      'padding-block': 'var(--ov-spacing-2)',
      'white-space': 'nowrap',
      'text-overflow': 'ellipsis',
      overflow: 'hidden',
      'min-width': '0',
      margin: '0',
      color: 'var(--ov-fg)',
    });
    expect(rule('.subtitle')).toMatchObject({ color: 'var(--ov-fg-muted)', 'font-weight': '400', 'font-size': 'inherit' });
  });

  it('puts the 20 px tile 4 px down, at the start of the row, and the title beside it', () => {
    expect(rule('.row > [data-ov-header-tile]')).toMatchObject({ 'grid-column': '1', 'grid-row': '1', 'align-self': 'start', 'margin-block-start': 'var(--ov-spacing-4)' });
    expect(rule('.row[data-ov-tile] .title')['grid-column']).toBe('2');
  });

  it('is the identity line: ONE 28 px line that never wraps, 12/16 muted type, 8 px apart, whatever it holds', () => {
    expect(rule('.meta')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'nowrap',
      'align-items': 'center',
      gap: 'var(--ov-spacing-8)',
      'min-width': '0',
      'min-height': 'var(--ov-control-height)',
      'grid-column': '1 / -1',
      'grid-row': '2',
      color: 'var(--ov-fg-muted)',
      'font-size': 'var(--ov-fs-12)',
      'line-height': 'var(--ov-lh-16)',
    });
    expect(rule('.meta[data-ov-line=\'plain\']')['min-height']).toBe('var(--ov-lh-16)');
    expect(rule('.row[data-ov-tile] .meta')['grid-column']).toBe('2 / -1');
  });

  it('is the state chip of the mock: 24 px, a 2 px and 6 px padding, a subtle border, the inline fill, never shrunk', () => {
    expect(rule('.state')).toMatchObject({
      display: 'inline-flex',
      flex: 'none',
      'align-items': 'center',
      'min-height': '24px',
      padding: 'var(--ov-spacing-2) var(--ov-spacing-6)',
      border: '1px solid var(--ov-border-subtle)',
      'border-radius': 'var(--ov-radius-control)',
      'background-color': 'var(--ov-bg-inline)',
    });
  });

  it('keeps the facts at their size, lets only the last give way, and draws the dot between them, so a fact never loses its separator', () => {
    expect(rule('.facts')).toMatchObject({ display: 'flex', flex: '0 1 auto', 'min-width': '0', overflow: 'clip', 'overflow-clip-margin': '4px' });
    expect(rule('.fact')).toMatchObject({ display: 'inline-flex', flex: 'none', gap: 'var(--ov-spacing-4)', 'min-width': '0' });
    expect(rule('.fact:last-child').flex).toBe('0 1 auto');
    expect(rule('.fact + .fact::before')).toMatchObject({ 'margin-inline': 'var(--ov-spacing-8) var(--ov-spacing-4)', color: 'var(--ov-fg-secondary)' });
    expect(rule('.factText')).toMatchObject({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('puts the reason at the end of the line, shrinking before the facts do', () => {
    expect(rule('.reason')).toMatchObject({ flex: '0 4 auto', 'min-width': '0', 'margin-inline-start': 'auto', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('puts the lane at the end of the title row, 8 px apart, wrapping', () => {
    expect(rule('.commands')).toMatchObject({ 'grid-column': '-2 / -1', 'grid-row': '1', display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', 'justify-content': 'flex-end', gap: 'var(--ov-spacing-8)', 'min-width': '0' });
  });

  describe('the operation slot', () => {
    it('has no width at rest and no line of its own: it is a 28 px box of no width at the end of the line', () => {
      expect(rule('.slot')).toMatchObject({ flex: '0 0 0px', 'inline-size': '0', 'min-inline-size': '0', 'min-block-size': 'var(--ov-control-height)', 'margin-inline-start': 'auto', overflow: 'hidden' });
    });

    it('is 360 px while an operation shows, and 480 px from 1000 px of page width', () => {
      expect(rule('.row')['--_op-size']).toBe('360px');
      expect(rule('.slot[data-ov-open]')).toMatchObject({ flex: '0 1 var(--_op-size)', 'inline-size': 'auto', 'min-inline-size': 'min(240px, 100%)', overflow: 'visible' });
      expect(inContainer('.row', '(width >= 1000px)')['--_op-size']).toBe('480px');
    });

    it('is the third cell of a row that has no identity line, between the title and the commands', () => {
      expect(rule('.row[data-ov-slot-row] > .slot')).toMatchObject({ 'grid-row': '1', 'grid-column': '-3 / -2', 'align-self': 'start', 'justify-self': 'end', 'margin-inline-start': '0' });
      expect(rule('.row[data-ov-slot-row] > .slot[data-ov-open]')).toMatchObject({ 'inline-size': 'min(var(--_op-size), 50cqi)', 'min-inline-size': '0' });
    });

    it('takes the place of the facts and the reason below 1000 px of page width, while it shows, and fills the rest of the line', () => {
      expect(inContainer('.meta[data-ov-op] > .facts', '(width < 1000px)').display).toBe('none');
      expect(inContainer('.meta[data-ov-op] > .reason', '(width < 1000px)').display).toBe('none');
      expect(inContainer('.meta > .slot[data-ov-open]', '(width < 1000px)')).toMatchObject({ flex: '1 1 0px', 'min-inline-size': '0', 'margin-inline-start': '0' });
    });
  });

  describe('where the lane sits below its width, by the width of the page (the mock\'s container queries)', () => {
    const dropped = { 'grid-column': '1 / -1', 'grid-row': '3', 'justify-content': 'flex-start', 'margin-block-start': 'var(--ov-spacing-4)' };

    it('drops a long lane under the identity line below 800 px', () => {
      expect(inContainer('.root[data-ov-lane=\'default\'] .commands', '(width < 800px)')).toMatchObject(dropped);
    });

    it('keeps a lane that fits one row beside the title down to 700 px', () => {
      expect(inContainer('.root[data-ov-lane=\'beside\'] .commands', '(width < 700px)')).toMatchObject(dropped);
    });

    it('keeps a short lane on the title row down to 520 px', () => {
      expect(inContainer('.root[data-ov-lane=\'short\'] .commands', '(width < 520px)')).toMatchObject(dropped);
    });
  });

  it('draws the breadcrumb as the mock does: 12/16 muted text, 4 px apart, links in the link colour that underline on hover', () => {
    expect(rule('.crumbs')).toMatchObject({ color: 'var(--ov-fg-muted)', 'font-size': 'var(--ov-fs-12)', 'line-height': 'var(--ov-lh-16)' });
    expect(rule('.crumbList')).toMatchObject({ display: 'flex', 'align-items': 'center', 'flex-wrap': 'wrap', gap: 'var(--ov-spacing-4)', margin: '0', padding: '0', 'list-style': 'none' });
    expect(rule('.crumbLink')).toMatchObject({ color: 'var(--ov-link)', background: 'none', border: '0', padding: '0' });
    expect(rule('.crumbLink:hover')['text-decoration']).toBe('underline');
    expect(rule('.crumbLink:focus-visible').outline).toBe('2px solid var(--ov-accent)');
  });

  it('uses only tokens for colour and type, and no hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });
});
