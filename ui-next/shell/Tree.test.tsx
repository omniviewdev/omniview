import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTreeMemory } from './core/tree';
import type { ShellTreeNode } from './registration';
import { Tree } from './Tree';

// The sidebar's tree on its own, over an invented sidebar: the count slot at the end of an entry's row (what each kind of count draws, what a row that has no number yet holds, how a row is named) and the
// open groups the tree tells its host (the plugin's sidebar hook is told which groups are on screen, so it asks for the counts of the rows that are).

const entry = (id: string, label: string, count?: ShellTreeNode['count']): ShellTreeNode => ({ id, label, icon: 'box', ...(count === undefined ? {} : { count }) });
const group = (id: string, label: string, children: readonly ShellTreeNode[]): ShellTreeNode => ({ id, label, icon: 'layers', children });

type Props = Partial<Parameters<typeof Tree>[0]>;

function renderTree(nodes: readonly ShellTreeNode[], props: Props = {}) {
  const tree = (over: Props = {}) => <Tree label="Acme items" nodes={nodes} open={['things']} current={undefined} accent={undefined} onChoose={undefined} {...props} {...over} />;
  const view = render(tree());
  return { ...view, again: (over: Props = {}) => {
    view.rerender(tree(over)); 
  } };
}

afterEach(cleanup);

describe('the count slot of an entry', () => {
  it('draws a number in grouped digits, and names the row by its label and the number', () => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha', 89), entry('b', 'Beta', 1234), entry('c', 'Gamma', 0)])]);

    expect(screen.getByRole('treeitem', { name: 'Alpha 89' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Beta 1,234' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Gamma 0' })).toBeInTheDocument();
  });

  it('draws an approximate count with a tilde before its grouped digits, and names the row in words: "about", not "tilde"', () => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha', { value: 1234, approximate: true })])]);

    const row = screen.getByRole('treeitem', { name: 'Alpha about 1,234' });
    const slot = row.querySelector('[data-shell-part="count"]');
    // What a sighted user reads is the tilde and the digits, and that is hidden from assistive technology; the words that are said are not drawn.
    expect(slot?.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^~1,234$/);
    expect(slot?.querySelector('[aria-hidden="true"]')?.nextElementSibling).toHaveTextContent(/^about 1,234$/);
    // The row's name is its content, and holds the label as it is drawn: no `aria-label` stands in for it (axe: label-content-name-mismatch).
    expect(row).not.toHaveAttribute('aria-label');
  });

  it('draws a number below a thousand exactly as it was drawn before there was an approximate count: its digits, and a name of the label and the digits', () => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha', 89)])]);

    const row = screen.getByRole('treeitem', { name: 'Alpha 89' });
    expect(row).toHaveTextContent('Alpha 89');
    expect(row.querySelector('[data-shell-part="count"]')).toHaveTextContent(/^89$/);
    expect(row).not.toHaveAttribute('aria-label');
  });

  it('holds the slot for a row whose count is not known yet (null), draws nothing in it, and names the row by its label alone', () => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha', null), entry('b', 'Beta', 5)])]);

    const row = screen.getByRole('treeitem', { name: 'Alpha' });
    const slot = row.querySelector('[data-shell-part="count"]');
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(screen.getByRole('treeitem', { name: 'Beta 5' }).querySelector('[data-shell-part="count"]')).not.toBeNull();
  });

  it('has no slot on a row that has no count: absent is not null', () => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha')])]);

    expect(screen.getByRole('treeitem', { name: 'Alpha' }).querySelector('[data-shell-part="count"]')).toBeNull();
  });

  it('keeps the slot when a count arrives: the row it is in is the same element, and its label is not replaced', () => {
    const view = renderTree([group('things', 'Things', [entry('a', 'Alpha', null)])]);
    const row = screen.getByRole('treeitem', { name: 'Alpha' });
    const label = row.children[1];
    const slot = row.querySelector('[data-shell-part="count"]');

    view.again({ nodes: [group('things', 'Things', [entry('a', 'Alpha', { value: 326, approximate: true })])] });

    expect(screen.getByRole('treeitem', { name: 'Alpha about 326' })).toBe(row);
    expect(row.children[1]).toBe(label);
    expect(row.querySelector('[data-shell-part="count"]')).toBe(slot);
  });

  it.each([
    ['a negative number', -1],
    ['a fraction', 2.5],
    ['not a number', Number.NaN],
  ])('draws an empty slot, and does not throw, for %s: a count that is not a count is no count', (_name, value) => {
    renderTree([group('things', 'Things', [entry('a', 'Alpha', value), entry('b', 'Beta', { value, approximate: true })])]);

    for (const name of ['Alpha', 'Beta']) {
      expect(screen.getByRole('treeitem', { name }).querySelector('[data-shell-part="count"]')).toBeEmptyDOMElement();
    }
  });
});

describe('the badge and the colour of an entry (KL5)', () => {
  it('draws the glyph of the kit\'s Status for the badge\'s role after the count, and says what it stands for as the row\'s text and as the glyph\'s tip: the row is named by its label, its count and the badge\'s words', () => {
    renderTree([group('things', 'Things', [{ ...entry('a', 'Alpha', 5), status: { role: 'attention', label: 'Needs sign-in' } }, entry('b', 'Beta', 2)])]);

    const row = screen.getByRole('treeitem', { name: 'Alpha 5 Needs sign-in' });
    const badge = row.querySelector('[data-shell-part="status"]');
    expect(badge).toHaveAttribute('data-ov-tip', 'Needs sign-in');
    expect(badge?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'status-warning');
    expect(row.querySelector('[data-shell-part="count"]')?.nextElementSibling).toBe(badge);
    expect(row).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('treeitem', { name: 'Beta 2' }).querySelector('[data-shell-part="status"]')).toBeNull();
  });

  it('says the colour a glyph is tinted with as a data attribute the stylesheet reads, on the entry that names one and on no other', () => {
    renderTree([group('things', 'Things', [{ ...entry('a', 'Alpha'), tone: 'green' }, entry('b', 'Beta')])], { accent: 'blue' });

    expect(screen.getByRole('treeitem', { name: 'Alpha' })).toHaveAttribute('data-tone', 'green');
    expect(screen.getByRole('treeitem', { name: 'Beta' })).not.toHaveAttribute('data-tone');
  });
});

describe('a label that is cut (ch12 SB1: a long name is clipped at its end, with the full name as a tooltip)', () => {
  it('is a clipping element for the one tooltip of the window, which names it in full while it is cut and says nothing while it is not: its text is its name, and no title or tip of its own repeats it', () => {
    renderTree([group('things', 'Things', [entry('a', 'A name much too long for the room it is given', 12), entry('b', 'Beta')])]);

    for (const name of [/^A name much too long/, 'Beta', 'Things']) {
      const row = screen.getByRole('treeitem', { name });
      const label = row.children[1];
      expect(label).toHaveAttribute('data-ov-clip');
      expect(label).not.toHaveAttribute('data-ov-tip');
      expect(label).not.toHaveAttribute('title');
      expect(row).not.toHaveAttribute('data-ov-tip');
      expect(row).not.toHaveAttribute('title');
    }
  });
});

describe('the open groups the tree tells its host', () => {
  const nodes = [
    group('things', 'Things', [entry('a', 'Alpha'), group('inner', 'Inner', [entry('b', 'Beta')])]),
    group('more', 'More', [entry('c', 'Gamma')]),
    entry('top', 'Top'),
  ];

  it('tells it the groups that are open when the tree mounts: the ones the registration asked for and the ancestors of the current entry, sorted', () => {
    const onOpenChange = vi.fn();
    renderTree(nodes, { open: ['more'], current: 'b', onOpenChange });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(['inner', 'more', 'things']);
  });

  it('tells it again when the user opens or closes a group, and only then', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderTree(nodes, { open: [], current: undefined, onOpenChange });
    expect(onOpenChange).toHaveBeenLastCalledWith([]);
    onOpenChange.mockClear();

    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(['things']);

    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(['more', 'things']);

    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(['more']);
    expect(onOpenChange).toHaveBeenCalledTimes(3);
  });

  it('tells it when the keyboard opens a group', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderTree(nodes, { open: [], current: undefined, onOpenChange });
    onOpenChange.mockClear();

    act(() => {
      screen.getByRole('treeitem', { name: 'Things' }).focus();
    });
    await user.keyboard('{ArrowRight}');

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(['things']);
  });

  it('does not tell it a group that is open inside a group that is closed: none of its entries is on screen', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderTree(nodes, { open: ['things', 'inner'], current: undefined, onOpenChange });
    expect(onOpenChange).toHaveBeenLastCalledWith(['inner', 'things']);

    await user.click(screen.getByRole('treeitem', { name: 'Things' }));

    expect(screen.queryByRole('treeitem', { name: 'Beta' })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith([]);

    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(['inner', 'things']);
  });

  it('does not tell it again when it renders again with the same groups open: a new count, a new label or a new array of nodes is not a change of what is on screen', () => {
    const onOpenChange = vi.fn();
    const view = renderTree(nodes, { open: ['things'], onOpenChange });
    expect(onOpenChange).toHaveBeenCalledTimes(1);

    view.again({ nodes: [group('things', 'Things', [entry('a', 'Alpha', 3), group('inner', 'Inner', [entry('b', 'Beta')])]), nodes[1], nodes[2]], onOpenChange });
    view.again({ onOpenChange });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it('tells it that nothing is open when the tree goes away: the groups of a sidebar that is not on screen are not open', () => {
    const onOpenChange = vi.fn();
    const view = renderTree(nodes, { open: ['things'], onOpenChange });
    onOpenChange.mockClear();

    view.unmount();

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith([]);
  });

  it('is a tree like any other when its host does not listen', async () => {
    const user = userEvent.setup();
    renderTree(nodes, { open: [] });

    await user.click(screen.getByRole('treeitem', { name: 'Things' }));

    expect(screen.getByRole('treeitem', { name: 'Alpha' })).toBeInTheDocument();
  });
});

describe('the open groups a tree keeps while it is not on screen (the plugin stopped and came back, the rail went elsewhere and returned)', () => {
  const nodes = [
    group('things', 'Things', [entry('a', 'Alpha'), group('inner', 'Inner', [entry('b', 'Beta')])]),
    group('more', 'More', [entry('c', 'Gamma')]),
    entry('top', 'Top'),
  ];
  const memoryOf = () => ({ memory: createTreeMemory(), memoryKey: 'acme\u0000Acme items' });

  it('opens again as the user left it: the groups they opened are open when the tree comes back, the ones they did not are not', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: [], current: 'top' });
    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    await user.click(screen.getByRole('treeitem', { name: 'Inner' }));
    first.unmount();
    expect(screen.queryByRole('tree')).toBeNull();

    renderTree(nodes, { ...kept, open: [], current: 'top' });

    expect(screen.getByRole('treeitem', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Things' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a group the user closed closed, though the current entry is inside it: the entry is brought into view once, not every time the tree comes back', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: [], current: 'a' });
    expect(screen.getByRole('treeitem', { name: 'Alpha' })).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    expect(screen.queryByRole('treeitem', { name: 'Alpha' })).toBeNull();
    first.unmount();

    renderTree(nodes, { ...kept, open: [], current: 'a' });

    expect(screen.queryByRole('treeitem', { name: 'Alpha' })).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Things' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('brings another current entry into view when the tree comes back with one: what the user closed stays closed for the entry they were on, and opens for the one they are on now', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: [], current: 'a' });
    await user.click(screen.getByRole('treeitem', { name: 'Things' }));
    first.unmount();

    renderTree(nodes, { ...kept, open: [], current: 'c' });

    expect(screen.getByRole('treeitem', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'Things' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('tells its host the groups it comes back with, once: the plugin\'s hook asks for the counts of the rows that are on screen again', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: [], current: 'top', onOpenChange: vi.fn() });
    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    first.unmount();
    const onOpenChange = vi.fn();

    renderTree(nodes, { ...kept, open: [], current: 'top', onOpenChange });

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(['more']);
  });

  it('keeps a group that is not in the nodes yet: the plugin\'s skeleton comes first and its data after, and what the user opened is not lost with the first', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: [], current: 'top' });
    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    first.unmount();

    const again = renderTree([nodes[0], nodes[2]], { ...kept, open: [], current: 'top' });
    expect(screen.queryByRole('treeitem', { name: 'Gamma' })).toBeNull();
    again.again({ nodes });

    expect(screen.getByRole('treeitem', { name: 'Gamma' })).toBeInTheDocument();
  });

  it('starts from the registration, as a tree always did, when it was never on screen under its key: the groups it asks for, and the ancestors of the current entry', () => {
    renderTree(nodes, { ...memoryOf(), open: ['more'], current: 'b' });

    expect(screen.getByRole('treeitem', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Beta' })).toBeInTheDocument();
  });

  it('lets what the user did win over the groups the registration asks for: a group they closed is not opened again by `open` when the tree comes back', async () => {
    const user = userEvent.setup();
    const kept = memoryOf();
    const first = renderTree(nodes, { ...kept, open: ['more'], current: 'top' });
    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    expect(screen.queryByRole('treeitem', { name: 'Gamma' })).toBeNull();
    first.unmount();

    renderTree(nodes, { ...kept, open: ['more'], current: 'top' });

    expect(screen.queryByRole('treeitem', { name: 'Gamma' })).toBeNull();
  });

  it('keeps one memory for each key: the tree of another entry starts afresh, and a tree under a key it shares with none is not changed by it', async () => {
    const user = userEvent.setup();
    const { memory } = memoryOf();
    const first = renderTree(nodes, { memory, memoryKey: 'acme', open: [], current: 'top' });
    await user.click(screen.getByRole('treeitem', { name: 'More' }));
    first.unmount();

    renderTree(nodes, { memory, memoryKey: 'beta', open: [], current: 'top' });

    expect(screen.queryByRole('treeitem', { name: 'Gamma' })).toBeNull();
  });
});
