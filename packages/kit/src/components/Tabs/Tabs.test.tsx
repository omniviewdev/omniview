import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { TabPanel, Tabs, type TabPanelProps, type TabsItem, type TabsProps } from './Tabs';
import * as examples from './Tabs.examples';

const TABS: readonly TabsItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'items', label: 'Items', count: 3 },
  { id: 'events', label: 'Events' },
  { id: 'yaml', label: 'YAML' },
];

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

// A strip with its panel, the caller owning the selection.
function Harness({ initial = 'overview', tabs = TABS, onSelect }: { readonly initial?: string; readonly tabs?: readonly TabsItem[]; readonly onSelect?: (id: string) => void }) {
  const [selected, setSelected] = useState(initial);
  return (
    <>
      <Tabs
        id="detail"
        label="Item sections"
        tabs={tabs}
        selected={selected}
        onSelect={(id) => {
          onSelect?.(id);
          setSelected(id);
        }}
      />
      <TabPanel id="detail" selected={selected}>
        {selected} section
      </TabPanel>
    </>
  );
}

// A tab by what it reads as. The accessible name of a face with a count is computed by the platform (a browser reads the count's leading
// space; jsdom's name computation drops it), so the name is not what these tests compare.
const tab = (text: string): HTMLElement => {
  const face = screen.getAllByRole('tab').find((candidate) => candidate.textContent === text);
  if (face === undefined) {
    throw new Error(`no tab reads ${text}`);
  }

  return face;
};

const press = (element: HTMLElement, key: string, modifiers: Record<string, boolean> = {}) => fireEvent.keyDown(element, { key, ...modifiers });

describe('Tabs', () => {
  describe('markup', () => {
    it('is a tablist named for what the tabs are sections of, with one native button per tab', () => {
      const { container } = render(<Harness />);
      const list = screen.getByRole('tablist', { name: 'Item sections' });
      expect(list.getAttribute('data-ov-part')).toBe('tabs');
      expect(screen.getAllByRole('tab')).toHaveLength(4);
      for (const face of screen.getAllByRole('tab')) {
        expect(face.tagName).toBe('BUTTON');
        expect(face.getAttribute('type')).toBe('button');
        expect(face.getAttribute('data-ov-part')).toBe('tab');
        expect(face.parentElement).toBe(list);
        for (const attribute of ['title', 'style', 'aria-label', 'disabled']) {
          expect(face.hasAttribute(attribute), attribute).toBe(false);
        }
      }

      expect(container.querySelector('[title]')).toBeNull();
    });

    it('derives its ids from the base id: the tab is <id>-tab-<tab id>, and it controls the one panel <id>-panel', () => {
      render(<Harness />);
      expect(tab('Overview').id).toBe('detail-tab-overview');
      expect(tab('Items 3').id).toBe('detail-tab-items');
      for (const face of screen.getAllByRole('tab')) {
        expect(face.getAttribute('aria-controls')).toBe('detail-panel');
      }

      const panel = screen.getByRole('tabpanel');
      expect(panel.id).toBe('detail-panel');
      expect(document.getElementById(tab('Overview').getAttribute('aria-controls') ?? '')).toBe(panel);
    });

    it('labels the panel by the selected tab, and follows the selection', () => {
      render(<Harness initial="items" />);
      const panel = screen.getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe('detail-tab-items');
      expect(panel.getAttribute('data-ov-part')).toBe('tab-panel');
      fireEvent.click(tab('Events'));
      expect(screen.getByRole('tabpanel', { name: 'Events' }).getAttribute('aria-labelledby')).toBe('detail-tab-events');
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    });

    it('says which tab is selected with aria-selected and data-ov-selected, and one only', () => {
      render(<Harness initial="events" />);
      for (const face of screen.getAllByRole('tab')) {
        const selected = face.textContent === 'Events';
        expect(face.getAttribute('aria-selected'), face.textContent ?? '').toBe(String(selected));
        expect(face.getAttribute('data-ov-selected'), face.textContent ?? '').toBe(selected ? 'true' : null);
      }
    });

    it('draws a count as a muted span after the label, with a leading space, and the tab reads as both', () => {
      render(<Harness />);
      const face = tab('Items 3');
      const countSpan = face.querySelector('[data-ov-part="tab-count"]');
      expect(countSpan?.tagName).toBe('SPAN');
      expect(countSpan?.textContent).toBe(' 3');
      expect(face.firstChild?.textContent).toBe('Items');
      expect(face.querySelectorAll('[data-ov-part="tab-count"]')).toHaveLength(1);
      expect(tab('Overview').querySelector('[data-ov-part="tab-count"]')).toBeNull();
    });

    it('prints a count of zero: zero is a value', () => {
      render(<Harness tabs={[{ id: 'alerts', label: 'Alerts', count: 0 }]} initial="alerts" />);
      expect(tab('Alerts 0').textContent).toBe('Alerts 0');
    });

    it('draws an icon before the label, decorative, and none when there is none', () => {
      render(<Harness tabs={[{ id: 'overview', label: 'Overview', icon: 'layers' }, { id: 'items', label: 'Items' }]} />);
      const face = tab('Overview');
      expect(face.firstElementChild?.tagName.toLowerCase()).toBe('svg');
      expect(face.firstElementChild).toHaveProperty('dataset.ovGlyph', 'layers');
      expect(face.firstElementChild).toHaveProperty('dataset.ovSize', '16');
      expect(face.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(tab('Items').querySelector('svg')).toBeNull();
    });

    it('draws nothing at all with no tabs', () => {
      const { container } = render(<Tabs id="detail" label="Item sections" tabs={[]} selected="" onSelect={() => undefined} />);
      expect(container.innerHTML).toBe('');
    });

    it('has the elements it says: the strip and one button per tab, plus a span for a count and an svg and a path for an icon', () => {
      const select = () => undefined;
      expect(count(<Tabs id="d" label="L" tabs={TABS.slice(0, 1)} selected="overview" onSelect={select} />)).toBe(2);
      expect(count(<Tabs id="d" label="L" tabs={TABS} selected="overview" onSelect={select} />)).toBe(1 + 4 + 1);
      expect(count(<Tabs id="d" label="L" tabs={[{ id: 'a', label: 'A', icon: 'layers' }]} selected="a" onSelect={select} />)).toBeGreaterThanOrEqual(4);
      expect(count(<TabPanel id="d" selected="a" />)).toBe(1);
    });
  });

  describe('one tab stop', () => {
    it('puts only the selected tab in the tab order', () => {
      render(<Harness initial="events" />);
      expect(screen.getAllByRole('tab').map((face) => [face.textContent, face.tabIndex])).toEqual([
        ['Overview', -1],
        ['Items 3', -1],
        ['Events', 0],
        ['YAML', -1],
      ]);
    });

    it('moves the stop with the selection', () => {
      render(<Harness />);
      fireEvent.click(tab('YAML'));
      expect(screen.getAllByRole('tab').filter((face) => face.tabIndex === 0).map((face) => face.textContent)).toEqual(['YAML']);
    });

    it('falls back to the first tab as the stop when the selected id names no tab, so the strip stays reachable', () => {
      render(<Tabs id="detail" label="Item sections" tabs={TABS} selected="gone" onSelect={() => undefined} />);
      expect(screen.getAllByRole('tab').filter((face) => face.tabIndex === 0).map((face) => face.textContent)).toEqual(['Overview']);
      expect(screen.getAllByRole('tab').filter((face) => face.getAttribute('aria-selected') === 'true')).toHaveLength(0);
    });
  });

  describe('selecting', () => {
    it('selects on a click, once, and does not report a click on the selected tab', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      fireEvent.click(tab('Events'));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('events');
      expect(tab('Events').getAttribute('aria-selected')).toBe('true');
      fireEvent.click(tab('Events'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('does not select by itself: the caller owns the selection', () => {
      const onSelect = vi.fn();
      render(<Tabs id="detail" label="Item sections" tabs={TABS} selected="overview" onSelect={onSelect} />);
      fireEvent.click(tab('YAML'));
      expect(onSelect).toHaveBeenCalledWith('yaml');
      expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
      expect(tab('YAML').getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('the keyboard', () => {
    it('moves the focus to the next tab with Right and selects it (automatic activation)', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      tab('Overview').focus();
      press(tab('Overview'), 'ArrowRight');
      expect(document.activeElement).toBe(tab('Items 3'));
      expect(onSelect).toHaveBeenCalledWith('items');
      expect(tab('Items 3').getAttribute('aria-selected')).toBe('true');
      expect(tab('Items 3').tabIndex).toBe(0);
      expect(tab('Overview').tabIndex).toBe(-1);
    });

    it('moves back with Left', () => {
      render(<Harness initial="events" />);
      tab('Events').focus();
      press(tab('Events'), 'ArrowLeft');
      expect(document.activeElement).toBe(tab('Items 3'));
      expect(tab('Items 3').getAttribute('aria-selected')).toBe('true');
    });

    it('wraps: Right on the last tab goes to the first, Left on the first goes to the last', () => {
      render(<Harness initial="yaml" />);
      tab('YAML').focus();
      press(tab('YAML'), 'ArrowRight');
      expect(document.activeElement).toBe(tab('Overview'));
      expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
      press(tab('Overview'), 'ArrowLeft');
      expect(document.activeElement).toBe(tab('YAML'));
      expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
    });

    it('goes to the first with Home and to the last with End, and selects', () => {
      render(<Harness initial="items" />);
      tab('Items 3').focus();
      press(tab('Items 3'), 'End');
      expect(document.activeElement).toBe(tab('YAML'));
      expect(tab('YAML').getAttribute('aria-selected')).toBe('true');
      press(tab('YAML'), 'Home');
      expect(document.activeElement).toBe(tab('Overview'));
      expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    });

    it('takes the arrows for itself: the default is prevented, even where nothing moves', () => {
      render(<Harness />);
      tab('Overview').focus();
      expect(press(tab('Overview'), 'ArrowRight')).toBe(false);
      expect(press(tab('Items 3'), 'Home')).toBe(false);
    });

    it('does not report a selection when the focus lands on the tab that is already selected', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      tab('Overview').focus();
      press(tab('Overview'), 'Home');
      expect(onSelect).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(tab('Overview'));
    });

    it('keeps the focus on the same element through the re-render that the selection causes', () => {
      render(<Harness />);
      const items = tab('Items 3');
      tab('Overview').focus();
      press(tab('Overview'), 'ArrowRight');
      expect(tab('Items 3')).toBe(items);
      expect(document.activeElement).toBe(items);
    });

    it('does nothing in a strip of one tab, and still takes the key', () => {
      const onSelect = vi.fn();
      render(<Harness tabs={TABS.slice(0, 1)} onSelect={onSelect} />);
      tab('Overview').focus();
      expect(press(tab('Overview'), 'ArrowRight')).toBe(false);
      expect(press(tab('Overview'), 'End')).toBe(false);
      expect(onSelect).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(tab('Overview'));
    });

    it('leaves a chord and a key that something else took to the page', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      tab('Overview').focus();
      const chords: Array<Record<string, boolean>> = [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }];
      for (const modifiers of chords) {
        expect(press(tab('Overview'), 'ArrowRight', modifiers), JSON.stringify(modifiers)).toBe(true);
        expect(press(tab('Overview'), 'End', modifiers), JSON.stringify(modifiers)).toBe(true);
      }

      expect(onSelect).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(tab('Overview'));
    });

    it('ignores the arrows of the other axis, Tab, Enter and Space: those are the browser\'s', () => {
      const onSelect = vi.fn();
      render(<Harness onSelect={onSelect} />);
      tab('Overview').focus();
      for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'a']) {
        expect(press(tab('Overview'), key), key).toBe(true);
      }

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('scrolls the tab that took the focus into view', () => {
      render(<Harness />);
      const scroll = vi.fn();
      tab('Items 3').scrollIntoView = scroll;
      tab('Overview').focus();
      press(tab('Overview'), 'ArrowRight');
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });
  });

  it('passes data-* attributes through and nothing else, on the strip and on the panel', () => {
    const LooseTabs = Tabs as unknown as ComponentType<Record<string, unknown>>;
    const LoosePanel = TabPanel as unknown as ComponentType<Record<string, unknown>>;
    const extras = { className: 'restyled', style: { color: 'red' }, title: 'hint', role: 'group', tabIndex: 5, 'aria-label': 'other' };
    render(
      <>
        <LooseTabs id="detail" label="Item sections" tabs={TABS} selected="overview" onSelect={() => undefined} data-testid="strip" {...extras} />
        <LoosePanel id="detail" selected="overview" data-testid="panel" {...extras} />
      </>,
    );
    const strip = screen.getByTestId('strip');
    const panel = screen.getByTestId('panel');
    expect(strip.getAttribute('class')).not.toContain('restyled');
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(strip.getAttribute('aria-label')).toBe('Item sections');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('detail-tab-overview');
    for (const attribute of ['style', 'title']) {
      for (const element of [strip, panel]) {
        expect(element.hasAttribute(attribute), attribute).toBe(false);
      }
    }

    // The strip is no stop of its own (its tabs are) and the caller's tabIndex reaches neither; the panel's stop is the part's own.
    expect(strip.hasAttribute('tabindex')).toBe(false);
    expect(panel.getAttribute('tabindex')).toBe('0');
  });

  it('makes the panel a tab stop of its own, after the strip\'s one: a panel that starts with text can be reached from the keyboard (APG tabs)', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('tabindex')).toBe('0');
    panel.focus();
    expect(document.activeElement).toBe(panel);
    // the strip keeps its one stop
    expect(screen.getAllByRole('tab').filter((face) => face.tabIndex === 0)).toHaveLength(1);
  });

  it('has closed props: no className, no style, a glyph of the registry, a number for a count', () => {
    // Types only: these are never rendered.
    const select = () => undefined;
    const base = { id: 'd', label: 'L', tabs: TABS, selected: 'overview', onSelect: select };
    const accepted: TabsProps[] = [base, { ...base, tabs: [{ id: 'a', label: 'A', icon: 'layers', count: 0 }, { id: 'b', label: 'B', icon: undefined, count: undefined }] }];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: TabsProps = { ...base, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: TabsProps = { ...base, style: { color: 'red' } };
    // @ts-expect-error a strip is named
    const unnamed: TabsProps = { id: 'd', tabs: TABS, selected: 'overview', onSelect: select };
    // @ts-expect-error a strip has a base id for its parts
    const noId: TabsProps = { label: 'L', tabs: TABS, selected: 'overview', onSelect: select };
    // @ts-expect-error the selection is the caller's
    const noSelected: TabsProps = { id: 'd', label: 'L', tabs: TABS, onSelect: select };
    // @ts-expect-error a glyph outside the registry
    const badIcon: TabsProps = { ...base, tabs: [{ id: 'a', label: 'A', icon: 'no-such-glyph' }] };
    // @ts-expect-error a count is a number
    const textCount: TabsProps = { ...base, tabs: [{ id: 'a', label: 'A', count: '3' }] };
    // @ts-expect-error a label is text, not an element
    const elementLabel: TabsProps = { ...base, tabs: [{ id: 'a', label: <b>A</b> }] };
    // @ts-expect-error a tab has a title attribute for no one: a tooltip is the shared host's
    const withTitle: TabsProps = { ...base, title: 'hint' };
    const panel: TabPanelProps[] = [{ id: 'd', selected: 'overview' }, { id: 'd', selected: 'overview', children: 'x' }];
    // @ts-expect-error className is not a prop of a kit part
    const panelClass: TabPanelProps = { id: 'd', selected: 'overview', className: 'x' };
    // @ts-expect-error a panel is named by the selected tab
    const panelNoSelected: TabPanelProps = { id: 'd' };
    expect([accepted, withClass, withStyle, unnamed, noId, noSelected, badIcon, textCount, elementLabel, withTitle, panel, panelClass, panelNoSelected]).toHaveLength(13);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      render(<Harness />);
      tab('Overview').focus();
      press(tab('Overview'), 'ArrowRight');
      fireEvent.click(tab('YAML'));
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a strip is shown in.
type Row = {
  /** The names of the tabs, in order. */
  readonly names: readonly string[];
  /** The name of the selected tab. */
  readonly selected: string;
  /** The base id. */
  readonly id: string;
};
const COUNTED = ['Overview', 'Items 3', 'Events 12', 'Metrics', 'YAML'];
const MATRIX: Readonly<Record<string, Row>> = {
  Plain: { names: ['Overview', 'Events', 'Metrics', 'YAML'], selected: 'Overview', id: 'tabs-plain' },
  WithCounts: { names: ['Overview', 'Items 3', 'Events 12', 'Alerts 0'], selected: 'Items 3', id: 'tabs-counts' },
  WithIcons: { names: ['Overview', 'Items 3', 'Events', 'Servers'], selected: 'Overview', id: 'tabs-icons' },
  SelectedMiddleTab: { names: COUNTED, selected: 'Events 12', id: 'tabs-middle' },
  ManyTabsInNarrowBox: { names: ['Overview', 'Items 3', 'Events', 'Servers', 'Metrics', 'YAML', 'History 7'], selected: 'Overview', id: 'tabs-narrow' },
  WithPanel: { names: COUNTED, selected: 'Overview', id: 'tabs-panel' },
  OneTab: { names: ['Overview'], selected: 'Overview', id: 'tabs-one' },
};

describe('Tabs examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: tabs ${row.names.join(', ')}, ${row.selected} selected, with its panel`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      // one named tablist, the tabs it says, one stop, and the one panel they control
      const list = screen.getByRole('tablist', { name: 'Item sections' });
      const faces = screen.getAllByRole('tab');
      expect(faces.map((face) => face.textContent?.replace(/\s+/g, ' ').trim())).toEqual(row.names);
      expect(faces.map((face) => face.getAttribute('aria-selected') === 'true' ? face.textContent : undefined).filter(Boolean)).toEqual([row.selected]);
      expect(faces.filter((face) => face.tabIndex === 0)).toHaveLength(1);
      expect(tab(row.selected).tabIndex).toBe(0);
      expect(list.getAttribute('data-ov-part')).toBe('tabs');
      const panel = screen.getByRole('tabpanel');
      expect(panel.id).toBe(`${row.id}-panel`);
      expect(panel.getAttribute('aria-labelledby')).toBe(tab(row.selected).id);
      expect(panel.tabIndex).toBe(0);
      for (const face of faces) {
        expect(face.id).toMatch(new RegExp(`^${row.id}-tab-`));
        expect(face.getAttribute('aria-controls')).toBe(panel.id);
        expect(document.getElementById(face.id)).toBe(face);
      }

      // every id the markup refers to exists, once
      for (const element of container.querySelectorAll('[id]')) {
        expect(container.querySelectorAll(`[id="${element.id}"]`)).toHaveLength(1);
      }

      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }

      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(container.querySelector('[title]')).toBeNull();
    });
  }

  it('WithPanel: choosing a tab switches the panel and keeps the one stop', () => {
    const Example = examples.WithPanel;
    render(<Example />);
    expect(screen.getByRole('tabpanel').textContent).toBe('Overview section');
    fireEvent.click(tab('Events 12'));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('Events 12').id);
    expect(screen.getByRole('tabpanel').textContent).toBe('Events section');
    expect(screen.getAllByRole('tab').filter((face) => face.tabIndex === 0).map((face) => face.textContent)).toEqual(['Events 12']);
  });

  it('SelectedMiddleTab: the arrows go both ways from the middle', () => {
    const Example = examples.SelectedMiddleTab;
    render(<Example />);
    tab('Events 12').focus();
    press(tab('Events 12'), 'ArrowLeft');
    expect(tab('Items 3').getAttribute('aria-selected')).toBe('true');
    press(tab('Items 3'), 'ArrowRight');
    press(tab('Events 12'), 'ArrowRight');
    expect(tab('Metrics').getAttribute('aria-selected')).toBe('true');
  });

  it('ManyTabsInNarrowBox: the strip sits in a narrower box and holds all its tabs', () => {
    const Example = examples.ManyTabsInNarrowBox;
    const { container } = render(<Example />);
    expect(container.firstElementChild?.contains(screen.getByRole('tablist'))).toBe(true);
    expect(screen.getAllByRole('tab')).toHaveLength(7);
  });
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here (the numbers of the
// mock's geometry) and what a browser paints from it is measured in WebKit and Chromium against the mock.
const css = await readFile(path.join(import.meta.dirname, 'Tabs.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Tabs stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s strip: a row of 40 px at least, 6 px of air above and below, faces 4 px apart, never wrapping, scrolling sideways', () => {
    expect(rule('.root')).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      gap: 'var(--ov-spacing-4)',
      'min-width': '0',
      'max-width': '100%',
      'min-height': '40px',
      padding: 'var(--ov-spacing-6) 0',
      'overflow-x': 'auto',
      'overflow-y': 'hidden',
      color: 'var(--ov-fg)',
    });
    expect(rule('.root')).not.toHaveProperty('flex-wrap');
  });

  it('draws each face as the mock does: the control height, 4 px by 12 px, a 1 px transparent edge, the tab radius, 13/16, one line, the pointer', () => {
    expect(rule('.tab')).toMatchObject({
      display: 'flex',
      'flex-shrink': '0',
      'align-items': 'center',
      'justify-content': 'center',
      gap: 'var(--ov-spacing-4)',
      'min-height': 'var(--ov-control-height)',
      padding: 'var(--ov-spacing-4) var(--ov-spacing-12)',
      border: '1px solid transparent',
      'border-radius': 'var(--ov-radius-tab)',
      'background-color': 'transparent',
      color: 'var(--ov-fg)',
      'font-size': 'var(--ov-fs-13)',
      'font-weight': '400',
      'line-height': 'var(--ov-lh-16)',
      'white-space': 'nowrap',
      cursor: 'pointer',
    });
  });

  it('resets the type of the button to the interface\'s', () => {
    const face = rule('.tab');
    expect(face['font-family']).toBe('var(--ov-font-ui)');
    expect(face['font-feature-settings']).toBe('var(--ov-font-features)');
    expect(face['font-synthesis']).toBe('none');
    expect(face['letter-spacing']).toBe('normal');
  });

  it('paints the toolbar hover on a face that is not selected, and nothing on the selected one', () => {
    expect(rule('.tab:not([data-ov-selected]):hover')).toEqual({ 'background-color': 'var(--ov-hover-toolbar)' });
    expect(css).not.toMatch(/\.tab:hover/);
  });

  it('paints the selected face with the tab fill and the tab edge', () => {
    expect(rule('.tab[data-ov-selected=\'true\']')).toEqual({ 'border-color': 'var(--ov-tab-border)', 'background-color': 'var(--ov-tab-bg)' });
  });

  it('gives the glyph of a face that is not selected the icon role', () => {
    expect(rule('.tab:not([data-ov-selected]) > svg')).toEqual({ color: 'var(--ov-icon)' });
  });

  it('draws the focus ring for the keyboard only, inside the face', () => {
    expect(rule('.tab:focus-visible')).toEqual({ outline: '2px solid var(--ov-accent)', 'outline-offset': '-2px' });
    expect(css).not.toMatch(/:focus\s*[{,]/);
  });

  it('prints the count in the face\'s own type, muted, in tabular figures', () => {
    expect(rule('.count')).toEqual({ color: 'var(--ov-fg-muted)', 'font-variant-numeric': 'tabular-nums' });
  });

  it('never fades a state with opacity, and takes its paint from tokens', () => {
    expect(css).not.toMatch(/opacity\s*:/);
    for (const token of ['--ov-fg', '--ov-fg-muted', '--ov-hover-toolbar', '--ov-tab-bg', '--ov-tab-border', '--ov-accent', '--ov-icon', '--ov-radius-tab', '--ov-control-height']) {
      expect(css, token).toContain(`var(${token})`);
    }
  });
  it('draws the focus of the panel inside it, as the face and the page region do', () => {
    expect(rule('.panel:focus-visible')).toMatchObject({ outline: '2px solid var(--ov-accent)', 'outline-offset': '-2px' });
  });
});
