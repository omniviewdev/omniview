import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ComponentType, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { RovingGroup, type RovingGroupProps } from './RovingGroup';
import * as examples from './RovingGroup.examples';

// What the group acts on is native buttons and links: plain elements stand in for the parts that go in one.
const Buttons = ({ names = ['One', 'Two', 'Three'], pressed }: { readonly names?: readonly string[]; readonly pressed?: string }) => (
  <>
    {names.map((name) => (
      <button key={name} type="button" aria-pressed={pressed === undefined ? undefined : pressed === name}>
        {name}
      </button>
    ))}
  </>
);

const button = (name: string) => screen.getByRole('button', { name });
const tabindexes = () => screen.getAllByRole('button').map((item) => item.getAttribute('tabindex'));
const focus = (name: string) => {
  act(() => {
    button(name).focus();
  });
};

/** Presses a key on the focused element; true when the key was left alone, false when the group took it (preventDefault). */
const press = (key: string, modifiers: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key, ...modifiers });
const focused = () => document.activeElement?.textContent;

describe('RovingGroup', () => {
  it('is a named group of its own, a div with role group and the label as its name', () => {
    render(
      <RovingGroup label="Item state">
        <Buttons />
      </RovingGroup>,
    );
    const group = screen.getByRole('group', { name: 'Item state' });
    expect(group.tagName).toBe('DIV');
    expect(group).toHaveProperty('dataset.ovRoving', 'row');
    for (const attribute of ['tabindex', 'title', 'style', 'aria-describedby']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  describe('one tab stop', () => {
    it('is the first item when nothing says otherwise, and every other item is out of the tab order', () => {
      render(
        <RovingGroup label="Items">
          <Buttons />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0', '-1', '-1']);
    });

    it('is the pressed, current or selected item, else the checked one: a selected row beats a switch that is on inside another row', () => {
      const { unmount } = render(
        <RovingGroup label="Items">
          <Buttons pressed="Three" />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['-1', '-1', '0']);
      unmount();

      const selected = render(
        <RovingGroup label="Items">
          <button type="button">One</button>
          <button type="button" aria-checked="true">Two</button>
          <button type="button" aria-selected="true">Three</button>
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['-1', '-1', '0']);
      selected.unmount();

      render(
        <RovingGroup label="Items">
          <button type="button">One</button>
          <button type="button" aria-checked="true">Two</button>
          <button type="button">Three</button>
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['-1', '0', '-1']);
    });

    it('takes aria-current as a pressed state unless it is false', () => {
      render(
        <RovingGroup label="Items">
          <button type="button" aria-current="false">One</button>
          <button type="button" aria-current="page">Two</button>
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['-1', '0']);
    });

    it('is the last item that had the focus, and stays there when the group renders again', () => {
      const { rerender } = render(
        <RovingGroup label="Items">
          <Buttons pressed="One" />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0', '-1', '-1']);
      focus('Two');
      expect(tabindexes()).toEqual(['-1', '0', '-1']);
      // the pressed item moves, the memory of the focus wins
      rerender(
        <RovingGroup label="Items">
          <Buttons pressed="Three" />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['-1', '0', '-1']);
    });

    it('writes nothing when the tab stop is already where it belongs', async () => {
      const { rerender } = render(
        <RovingGroup label="Items">
          <Buttons />
        </RovingGroup>,
      );
      const group = screen.getByRole('group');
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((list) => records.push(...list));
      observer.observe(group, { attributes: true, subtree: true, attributeFilter: ['tabindex'] });
      rerender(
        <RovingGroup label="Items">
          <Buttons />
        </RovingGroup>,
      );
      focus('One');
      await act(async () => {
        await Promise.resolve();
      });
      observer.disconnect();
      expect(records).toEqual([]);
    });

    it('is fixed again when the items change: a new item is not a tab stop, and a removed stop falls back to the first', () => {
      const { rerender } = render(
        <RovingGroup label="Items">
          <Buttons />
        </RovingGroup>,
      );
      rerender(
        <RovingGroup label="Items">
          <Buttons names={['Zero', 'One', 'Two', 'Three']} />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0', '-1', '-1', '-1']);
      focus('Three');
      rerender(
        <RovingGroup label="Items">
          <Buttons names={['Zero', 'One']} />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0', '-1']);
    });

    it('is fixed when a child changes the items on its own, without the group rendering', async () => {
      const Adds = () => {
        const [more, setMore] = useState(false);
        return (
          <>
            <button
              type="button"
              onClick={() => {
                setMore(true);
              }}
            >
              Add
            </button>
            {more ? <button type="button">Added</button> : null}
          </>
        );
      };

      render(
        <RovingGroup label="Items">
          <Adds />
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0']);
      await act(async () => {
        fireEvent.click(button('Add'));
        await Promise.resolve();
      });
      expect(tabindexes()).toEqual(['0', '-1']);
    });
  });

  describe('arrow keys', () => {
    const setup = (kind?: RovingGroupProps['kind']) => {
      render(
        <>
          <input aria-label="Before" />
          <RovingGroup label="Items" {...(kind === undefined ? {} : { kind })}>
            <Buttons />
          </RovingGroup>
          <input aria-label="After" />
        </>,
      );
    };

    it('move to the next and the previous item in a row with Right and Left, and take the tab stop with them', () => {
      setup('row');
      focus('One');
      expect(press('ArrowRight')).toBe(false);
      expect(focused()).toBe('Two');
      expect(tabindexes()).toEqual(['-1', '0', '-1']);
      expect(press('ArrowRight')).toBe(false);
      expect(focused()).toBe('Three');
      expect(press('ArrowLeft')).toBe(false);
      expect(focused()).toBe('Two');
    });

    it('do not wrap: at an end the key is taken and nothing moves', () => {
      setup('row');
      focus('Three');
      expect(press('ArrowRight')).toBe(false);
      expect(focused()).toBe('Three');
      focus('One');
      expect(press('ArrowLeft')).toBe(false);
      expect(focused()).toBe('One');
    });

    it('go to the first and the last item with Home and End', () => {
      setup('row');
      focus('Two');
      expect(press('End')).toBe(false);
      expect(focused()).toBe('Three');
      expect(press('Home')).toBe(false);
      expect(focused()).toBe('One');
    });

    it('leave the other axis alone in a row: Up and Down are not taken, so the page may scroll', () => {
      setup('row');
      focus('Two');
      expect(press('ArrowDown')).toBe(true);
      expect(press('ArrowUp')).toBe(true);
      expect(focused()).toBe('Two');
    });

    it('use Up and Down in a column, and leave Left and Right alone', () => {
      setup('column');
      focus('One');
      expect(press('ArrowDown')).toBe(false);
      expect(focused()).toBe('Two');
      expect(press('ArrowUp')).toBe(false);
      expect(focused()).toBe('One');
      expect(press('ArrowRight')).toBe(true);
      expect(press('ArrowLeft')).toBe(true);
      expect(focused()).toBe('One');
      expect(press('End')).toBe(false);
      expect(focused()).toBe('Three');
    });

    it('are a row by default', () => {
      setup();
      focus('One');
      expect(press('ArrowRight')).toBe(false);
      expect(focused()).toBe('Two');
    });

    it('ignore a key with Shift, Alt or Meta, and an arrow with Control, but take Control with Home and End', () => {
      setup('row');
      focus('One');
      for (const modifiers of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
        expect(press('ArrowRight', modifiers), JSON.stringify(modifiers)).toBe(true);
        expect(focused()).toBe('One');
      }

      expect(press('End', { ctrlKey: true })).toBe(false);
      expect(focused()).toBe('Three');
      expect(press('Home', { ctrlKey: true })).toBe(false);
      expect(focused()).toBe('One');
      expect(press('End', { shiftKey: true })).toBe(true);
    });

    it('have no type-ahead: a letter does nothing and is left alone', () => {
      setup('row');
      focus('One');
      expect(press('t')).toBe(true);
      expect(focused()).toBe('One');
    });

    it('are left to the field when they come from one: the group acts on its items only', () => {
      render(
        <RovingGroup label="Items">
          <Buttons />
          <input aria-label="Search" />
        </RovingGroup>,
      );
      act(() => {
        screen.getByRole('textbox', { name: 'Search' }).focus();
      });
      expect(press('ArrowLeft')).toBe(true);
      expect(press('Home')).toBe(true);
      expect(focused()).toBe('');
    });

    it('leave a key that something else took first', () => {
      setup('row');
      focus('One');
      const taken = (event: Event) => {
        event.preventDefault();
      };

      button('One').addEventListener('keydown', taken);
      expect(press('ArrowRight')).toBe(false);
      expect(focused()).toBe('One');
    });
  });

  describe('which elements are its items', () => {
    it('are buttons and links, not disabled or hidden, and the ones that carry the item marker', () => {
      render(
        <RovingGroup label="Items">
          <button type="button">Native</button>
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button" hidden>
            Hidden
          </button>
          <a href="#x">Link</a>
          <a>Anchor without a target</a>
          <span role="button" tabIndex={0}>
            Role button
          </span>
          <span data-roving-item="" tabIndex={0}>
            Marked
          </span>
          <button type="button">Last</button>
        </RovingGroup>,
      );
      focus('Native');
      press('ArrowRight');
      expect(focused()).toBe('Link');
      press('ArrowRight');
      expect(focused()).toBe('Role button');
      press('ArrowRight');
      expect(focused()).toBe('Marked');
      press('ArrowRight');
      expect(focused()).toBe('Last');
    });

    it('keep an item that is unavailable for a reason: aria-disabled stays reachable', () => {
      render(
        <RovingGroup label="Items">
          <button type="button">One</button>
          <button type="button" aria-disabled="true">
            Two
          </button>
          <button type="button">Three</button>
        </RovingGroup>,
      );
      focus('One');
      press('ArrowRight');
      expect(focused()).toBe('Two');
      press('ArrowRight');
      expect(focused()).toBe('Three');
    });

    it('leave out what sits in a menu, a radio group or a popover inside the group: those rove on their own', () => {
      const { container } = render(
        <RovingGroup label="Items">
          <button type="button">One</button>
          <div role="menu">
            <button type="button">Menu item</button>
          </div>
          <div role="radiogroup" aria-label="Choice">
            <button type="button">Radio</button>
          </div>
          <div popover="">
            <button type="button">In a popover</button>
          </div>
          <button type="button">Two</button>
        </RovingGroup>,
      );
      // jsdom hides a popover from the role queries, so the attributes are read from the markup
      expect([...container.querySelectorAll('button')].map((item) => item.getAttribute('tabindex'))).toEqual(['0', null, null, null, '-1']);
      focus('One');
      press('ArrowRight');
      expect(focused()).toBe('Two');
    });

    it('belong to the nearest group: a group inside a group has its own tab stop and its own keys', () => {
      render(
        <RovingGroup label="Outer">
          <button type="button">Outer one</button>
          <RovingGroup label="Inner">
            <button type="button">Inner one</button>
            <button type="button">Inner two</button>
          </RovingGroup>
          <button type="button">Outer two</button>
        </RovingGroup>,
      );
      expect(tabindexes()).toEqual(['0', '0', '-1', '-1']);
      focus('Outer one');
      press('ArrowRight');
      expect(focused()).toBe('Outer two');
      focus('Inner one');
      press('ArrowRight');
      expect(focused()).toBe('Inner two');
    });
  });

  it('scrolls the item it moves to into view, only as far as needed', () => {
    // jsdom has no scrollIntoView: the test gives the elements one, and takes it away again.
    const calls: unknown[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: (options: unknown) => {
        calls.push(options);
      },
    });
    try {
      render(
        <RovingGroup label="Items">
          <Buttons />
        </RovingGroup>,
      );
      focus('One');
      press('ArrowRight');
      expect(calls).toEqual([{ block: 'nearest', inline: 'nearest' }]);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('turns its layout props into data attributes for its stylesheet', () => {
    render(
      <RovingGroup label="Items" kind="column" gap={8} wrap align="center">
        <Buttons />
      </RovingGroup>,
    );
    const group = screen.getByRole('group');
    expect(group).toHaveProperty('dataset.ovRoving', 'column');
    expect(group).toHaveProperty('dataset.ovGap', '8');
    expect(group).toHaveProperty('dataset.ovWrap', 'true');
    expect(group).toHaveProperty('dataset.ovAlign', 'center');
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = RovingGroup as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { label: 'Items', children: <Buttons />, 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', tabIndex: 3, role: 'presentation', onKeyDown: () => undefined };
    render(<Loose {...loose} />);
    const group = screen.getByTestId('probe');
    expect(group.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(group.getAttribute('role')).toBe('group');
  });

  it('has closed props: a label, a kind and a gap of the scales, no className, no style', () => {
    // Types only: these are never rendered.
    const accepted: RovingGroupProps[] = [
      { label: 'Items' },
      { label: 'Items', kind: 'column', gap: 12, wrap: true, align: 'baseline', children: <Buttons /> },
      { label: 'Items', kind: undefined, gap: undefined, wrap: undefined, align: undefined },
    ];
    // @ts-expect-error a group is named: the label is required
    const nameless: RovingGroupProps = {};
    // @ts-expect-error className is not a prop of a kit part
    const withClass: RovingGroupProps = { label: 'Items', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: RovingGroupProps = { label: 'Items', style: { gap: 3 } };
    // @ts-expect-error a kind outside the closed set
    const unknownKind: RovingGroupProps = { label: 'Items', kind: 'grid' };
    // @ts-expect-error a gap outside the spacing scale
    const unknownGap: RovingGroupProps = { label: 'Items', gap: 10 };
    // @ts-expect-error an alignment outside the closed set
    const unknownAlign: RovingGroupProps = { label: 'Items', align: 'middle' };
    // @ts-expect-error a role outside the two the group may be: a group or a toolbar
    const withRole: RovingGroupProps = { label: 'Items', role: 'button' };
    expect([accepted, nameless, withClass, withStyle, unknownKind, unknownGap, unknownAlign, withRole]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(
      <RovingGroup label="Items">
        <Buttons />
      </RovingGroup>,
    );
    focus('One');
    press('ArrowRight');
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The stylesheet, as the rules it holds (jsdom lays nothing out; a browser's layout is probed in packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'RovingGroup.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the RovingGroup stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is a flex container that can shrink, a row or a column by its kind, that wraps when it is told to', () => {
    expect(rule('.root')).toMatchObject({ display: 'flex', 'box-sizing': 'border-box', 'min-width': '0' });
    expect(rule('.root[data-ov-roving=\'row\']')).toEqual({ 'flex-direction': 'row' });
    expect(rule('.root[data-ov-roving=\'column\']')).toEqual({ 'flex-direction': 'column' });
    expect(rule('.root[data-ov-wrap=\'true\']')).toEqual({ 'flex-wrap': 'wrap' });
  });

  it('has a rule for every step of the spacing scale and every alignment', () => {
    for (const step of [2, 4, 6, 8, 12, 16, 20, 24]) {
      expect(rule(`.root[data-ov-gap='${step}']`), String(step)).toEqual({ gap: `var(--ov-spacing-${step})` });
    }

    for (const [align, value] of [['start', 'flex-start'], ['center', 'center'], ['end', 'flex-end'], ['stretch', 'stretch'], ['baseline', 'baseline']] as const) {
      expect(rule(`.root[data-ov-align='${align}']`), align).toEqual({ 'align-items': value });
    }
  });

  it('paints nothing: a group has no box of its own', () => {
    const everything = cssRules(css).flatMap((entry) => Object.keys(entry.declarations));
    for (const property of ['color', 'background', 'background-color', 'border', 'outline', 'padding', 'margin', 'opacity']) {
      expect(everything, property).not.toContain(property);
    }
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a RovingGroup is shown in.
type Row = {
  readonly group: string;
  /** The names of the items in document order. */
  readonly items: readonly string[];
  /** The item that is the tab stop when the page loads. */
  readonly stop: string;
  readonly kind: 'row' | 'column';
};
const MATRIX: Readonly<Record<string, Row>> = {
  Row: { group: 'Text alignment', items: ['Left', 'Center', 'Right'], stop: 'Left', kind: 'row' },
  Column: { group: 'Sort by', items: ['Name', 'Size', 'Date'], stop: 'Name', kind: 'column' },
  PressedIsTheStop: { group: 'Item state', items: ['All 12', 'Running 9', 'Failed 3'], stop: 'Running 9', kind: 'row' },
  ReasonedDisabledStaysReachable: { group: 'Actions', items: ['Copy', 'Delete', 'Share'], stop: 'Copy', kind: 'row' },
  IconButtons: { group: 'View', items: ['List', 'Grid', 'Columns'], stop: 'List', kind: 'row' },
};

describe('RovingGroup examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: a group named ${row.group} of ${row.items.length} items, one tab stop (${row.stop})`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      const group = screen.getByRole('group', { name: row.group });
      expect(group).toHaveProperty('dataset.ovRoving', row.kind);
      const items = [...group.querySelectorAll('button')];
      // the items are the buttons the row names, by their accessible names, in document order
      expect(items).toEqual(row.items.map((name) => within(group).getByRole('button', { name })));
      // exactly one item is in the tab order, and it is the one the row says
      const stops = items.filter((item) => item.getAttribute('tabindex') === '0');
      expect(stops).toEqual([within(group).getByRole('button', { name: row.stop })]);
      expect(items.filter((item) => item.getAttribute('tabindex') === '-1')).toHaveLength(row.items.length - 1);
      // the keyboard reaches every item, in order, with the arrows of its axis: Home, then one step at a time
      act(() => {
        stops[0]?.focus();
      });
      fireEvent.keyDown(document.activeElement ?? group, { key: 'Home' });
      const forward = row.kind === 'row' ? 'ArrowRight' : 'ArrowDown';
      const visited = [document.activeElement];
      for (let step = 1; step < row.items.length; step += 1) {
        fireEvent.keyDown(document.activeElement ?? group, { key: forward });
        visited.push(document.activeElement);
      }

      expect(visited).toEqual(items);
      expect(document.querySelector('[title]')).toBeNull();
    });
  }
});
