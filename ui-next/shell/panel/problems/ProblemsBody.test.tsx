import type * as Kit from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Profiler, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenSubject } from '../subject';
import { createProblems } from './model';
import { ProblemsBody } from './ProblemsBody';
import { PROBLEMS_EMPTY_ICON } from './tool';
import type { Condition, Problems } from './types';

// The body of the Problems tool (ch16 S121): the conditions that are true now as the kit's table (a status, the source, the target, and the button that opens the row's subject), or the panel's empty state while none is. jsdom
// lays nothing out, so the table's region gets the size a browser would give it and rows are in view; what the table does with real widths, and how a long word is cut, is the probe's. The tests are plugin-agnostic: invented names.

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });
// jsdom has no canvas: the table measures text with an estimate and says nothing (the kit's own tests stub it the same way).
HTMLCanvasElement.prototype.getContext = () => null;

// The columns the body hands to the kit's table, as the table gets them: the kit's DataView is wrapped to keep hold of them, and delegates to the real one. The table renders a row by calling its columns' cells, so a test that
// watches those calls (`watchCells`) counts the rows that rendered, whatever the React Compiler did to the content of a cell.
const held = vi.hoisted(() => ({ columns: [] as ReadonlyArray<Kit.DataTableColumn<Condition>> }));

vi.mock('@omniviewdev/kit', async (importOriginal) => {
  const kit = await importOriginal<typeof Kit>();
  return {
    ...kit,
    DataView: (props: Parameters<typeof kit.DataView>[0]) => {
      held.columns = props.table.columns;
      return kit.DataView(props);
    },
  };
});

const condition = (key: string, over: Partial<Condition> = {}): Condition => ({
  key,
  severity: 'error',
  label: `Label ${key}`,
  title: `Alpha Cloud: the sentence of ${key}.`,
  source: { id: 'alpha', name: 'Alpha Cloud' },
  target: `item ${key}`,
  subject: { kind: 'plugin', plugin: 'alpha' },
  ...over,
});

/** The same condition as a producer builds it again on its next `set`: equal in every member, every nested object new. */
const again = (value: Condition): Condition => ({ ...value, source: { ...value.source }, subject: value.subject === undefined ? undefined : { ...value.subject } });

/** An error that has a page, a warning about a connection, and an info with neither a target nor a page: the three shapes a row can have. */
const ERROR = condition('e', { label: 'Did not start', title: 'Alpha Cloud: The plugin could not start, so its pages can\'t load data.', target: 'Alpha Cloud' });
const WARNING = condition('w', {
  severity: 'warning',
  label: 'Needs sign-in',
  title: 'north: The connection needs you to sign in.',
  source: { id: 'beta', name: 'Beta Cloud' },
  target: 'north',
  subject: { kind: 'connection', plugin: 'beta', connection: 'c-1' },
});
const INFO = condition('i', { severity: 'info', label: 'Update available', title: 'Alpha Cloud: A newer version is available.', target: undefined, subject: undefined });

type Mounted = {
  readonly problems: Problems;
  readonly open: OpenSubject;
  /** The phase of each commit of the body since the list was last emptied (`commits.length = 0`): `update` is a commit that the model's change asked for, `nested-update` one that a layout effect asked for. */
  readonly commits: string[];
  readonly view: RenderResult;
  readonly user: UserEvent;
  /** The same body with another `open`. */
  readonly give: (next: OpenSubject) => void;
};

function mount(initial: readonly Condition[] = [], open: OpenSubject = vi.fn(), problems: Problems = createProblems()): Mounted {
  if (initial.length > 0) {
    problems.set('p', initial);
  }

  const commits: string[] = [];
  const ui = (given: OpenSubject) => (
    <Profiler
      id="problems"
      onRender={(_id, phase) => {
        commits.push(phase);
      }}
    >
      <ProblemsBody problems={problems} open={given} />
    </Profiler>
  );
  const view = render(ui(open));
  return {
    problems,
    open,
    commits,
    view,
    user: userEvent.setup(),
    give: (next) => {
      view.rerender(ui(next));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rows = (): HTMLElement[] => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const cellsOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('cell');
const footer = (container: HTMLElement): string | undefined => container.querySelector('[data-ov-part="footer"]')?.textContent;
/** The word the Condition cell draws, and the role the kit's status gives it. */
const statusOf = (cell: HTMLElement): { readonly word: string | null | undefined; readonly role: string | null | undefined } => {
  const status = cell.querySelector('[data-ov-role]');
  return { word: status?.textContent, role: status?.getAttribute('data-ov-role') };
};

/** Watches the cells of the table's columns from now on: how many times they were called for each row, by the key of the row. The table calls the cells of a row when it renders it, and not otherwise. */
function watchCells(): Map<string, number> {
  const calls = new Map<string, number>();
  for (const column of held.columns) {
    const cell = column.cell;
    vi.spyOn(column, 'cell').mockImplementation((row): ReactNode => {
      calls.set(row.key, (calls.get(row.key) ?? 0) + 1);
      return cell(row);
    });
  }

  return calls;
}

describe('with no condition', () => {
  it('says that there is no problem and that plugins and connections are healthy, as the panel\'s polite status', () => {
    mount();
    const status = screen.getByRole('status');
    expect(within(status).getByText('No problems')).toBeInTheDocument();
    expect(within(status).getByText('Plugins and connections are healthy.')).toBeInTheDocument();
  });

  it('draws the glyph the tool names for it', () => {
    const { view } = mount();
    expect(view.container.querySelector('[data-ov-glyph]')).toHaveAttribute('data-ov-glyph', PROBLEMS_EMPTY_ICON);
  });

  it('draws only the empty state: no table, no scroll region and no footer', () => {
    const { view } = mount();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Problems' })).not.toBeInTheDocument();
    expect(footer(view.container)).toBeUndefined();
  });

  it('gives way to the table as soon as a condition is true, and comes back as soon as the last one stops being true', () => {
    const { problems } = mount();
    act(() => {
      problems.set('p', [ERROR]);
    });
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText('No problems')).not.toBeInTheDocument();
    act(() => {
      problems.set('p', []);
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No problems')).toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('lists each condition in the model\'s order: its word, its source and its target', () => {
    mount([INFO, ERROR, WARNING]);
    expect(rows().map((row) => [statusOf(cellsOf(row)[0]).word, cellsOf(row)[1]?.textContent, cellsOf(row)[2]?.textContent])).toEqual([
      ['Did not start', 'Alpha Cloud', 'Alpha Cloud'],
      ['Needs sign-in', 'Beta Cloud', 'north'],
      ['Update available', 'Alpha Cloud', '—'],
    ]);
  });

  it('draws the condition as the kit\'s status of its severity: an error, a warning that needs a look, an info', () => {
    mount([INFO, ERROR, WARNING]);
    expect(rows().map((row) => statusOf(cellsOf(row)[0]).role)).toEqual(['error', 'attention', 'info']);
  });

  it('puts the full sentence in the tooltip of the Condition cell, and in the cell for a screen reader', () => {
    mount([ERROR]);
    const cell = cellsOf(rows()[0])[0];
    expect(cell.querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', ERROR.title);
    expect(within(cell).getByText(ERROR.title)).toBeInTheDocument();
  });

  it('does not say a word twice to a screen reader: a sentence that is the word has no second copy', () => {
    const same = condition('s', { label: 'Disk almost full', title: 'Disk almost full' });
    mount([same]);
    const cell = cellsOf(rows()[0])[0];
    expect(within(cell).getAllByText('Disk almost full')).toHaveLength(1);
    expect(cell.querySelector('[data-ov-tip]')).toHaveAttribute('data-ov-tip', 'Disk almost full');
  });

  it('draws a missing target as the muted dash named No target, not as a word', () => {
    mount([INFO]);
    const target = cellsOf(rows()[0])[2];
    expect(within(target).getByRole('img', { name: 'No target' })).toBeInTheDocument();
    expect(target.textContent).toBe('—');
  });

  it('draws the source and the target in a box that tells the tooltip when it cuts them: the host shows the full name only while it is cut', () => {
    mount([ERROR]);
    const [, source, target] = cellsOf(rows()[0]);
    expect(source?.querySelector('[data-ov-clip]')?.textContent).toBe('Alpha Cloud');
    expect(target?.querySelector('[data-ov-clip]')?.textContent).toBe('Alpha Cloud');
  });

  it('names its columns Condition, Source, Target and Actions (that one is read and not drawn), with no Since and nothing to sort by', () => {
    mount([ERROR]);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Condition', 'Source', 'Target', 'Actions']);
    expect(within(table).queryByText('Since')).not.toBeInTheDocument();
    expect(within(table.querySelector('thead') as HTMLElement).queryAllByRole('button')).toEqual([]);
  });

  it('is the table named Problems, of one-line rows', () => {
    mount([ERROR]);
    expect(screen.getByRole('region', { name: 'Problems' })).toHaveAttribute('data-ov-lines', '1');
  });

  it('counts the problems in the footer: 3 problems, 1 problem', () => {
    const { view, problems } = mount([INFO, ERROR, WARNING]);
    expect(footer(view.container)).toBe('3 problems');
    act(() => {
      problems.set('p', [ERROR]);
    });
    expect(footer(view.container)).toBe('1 problem');
  });

  it('follows the model: a condition that comes is a row, one that goes is no row, and the more severe is first', () => {
    const { problems } = mount([WARNING, INFO]);
    expect(rows().map((row) => statusOf(cellsOf(row)[0]).word)).toEqual(['Needs sign-in', 'Update available']);
    act(() => {
      problems.set('p', [WARNING, INFO, ERROR]);
    });
    expect(rows().map((row) => statusOf(cellsOf(row)[0]).word)).toEqual(['Did not start', 'Needs sign-in', 'Update available']);
    act(() => {
      problems.set('p', [ERROR, INFO]);
    });
    expect(rows().map((row) => statusOf(cellsOf(row)[0]).word)).toEqual(['Did not start', 'Update available']);
  });

  it('has no filter, no toolbar and no inspector yet, and no control that stands in for them: its only buttons are the rows\'', () => {
    mount([INFO, ERROR, WARNING]);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    for (const role of ['toolbar', 'searchbox', 'combobox', 'radiogroup', 'dialog', 'tablist']) {
      expect(screen.queryByRole(role), role).not.toBeInTheDocument();
    }
  });
});

describe('opening a problem', () => {
  it('names each button for its action and its object: Open the target, or the source when there is none', () => {
    mount([INFO, ERROR, WARNING]);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Open Alpha Cloud', 'Open north', 'Open Alpha Cloud']);
  });

  it('opens the subject of the row when its button is clicked, once, and hands on the click so that its modifiers choose where it opens', () => {
    const { open } = mount([ERROR, WARNING]);
    fireEvent.click(screen.getByRole('button', { name: 'Open north' }), { metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ kind: 'connection', plugin: 'beta', connection: 'c-1' }, expect.objectContaining({ type: 'click', metaKey: true }));
  });

  it('opens the subject of a row that is clicked, with the click: the row does what its button does', () => {
    const { open } = mount([ERROR, WARNING]);
    fireEvent.click(cellsOf(rows()[1])[0], { shiftKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ kind: 'connection', plugin: 'beta', connection: 'c-1' }, expect.objectContaining({ type: 'click', shiftKey: true }));
  });

  it('is a button that a keyboard reaches with Tab and presses with Enter and with Space', async () => {
    const { open, user } = mount([ERROR]);
    // The table's own scroll region is the first stop; rows are not stops, so the row's action is the button.
    await user.tab();
    await user.tab();
    const button = screen.getByRole('button', { name: 'Open Alpha Cloud' });
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith({ kind: 'plugin', plugin: 'alpha' }, expect.objectContaining({ type: 'click' }));
  });

  it('is a Tab stop in every row, the one that cannot be opened as well: it is there and says why', () => {
    mount([INFO, ERROR, WARNING]);
    for (const button of screen.getAllByRole('button')) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it('says why a row with no page of its own cannot be opened, to a keyboard and a screen reader, and opens nothing from the button or from the row', () => {
    const { open } = mount([INFO]);
    const button = screen.getByRole('button', { name: 'Open Alpha Cloud' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('This problem has no page of its own');
    fireEvent.click(button);
    fireEvent.click(cellsOf(rows()[0])[0]);
    expect(open).not.toHaveBeenCalled();
  });

  it('draws the button of a row that can be opened with no reason', () => {
    mount([ERROR]);
    const button = screen.getByRole('button', { name: 'Open Alpha Cloud' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('opens with the function it is given now, not the one it was first given', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { give } = mount([ERROR], first);
    give(second);
    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha Cloud' }));
    fireEvent.click(cellsOf(rows()[0])[0]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe('what a change costs', () => {
  const alpha = condition('a', { label: 'Alpha word' });
  const beta = condition('b', { label: 'Beta word' });
  const gamma = condition('c', { label: 'Gamma word' });

  it('renders the row of the condition that changed and no other, though the producer built every condition anew', () => {
    const { problems } = mount([alpha, beta, gamma]);
    const cells = watchCells();
    act(() => {
      problems.set('p', [again(alpha), { ...again(beta), title: 'Alpha Cloud: the sentence changed.' }, again(gamma)]);
    });
    expect([...cells.keys()]).toEqual(['b']);
    expect(cells.get('b')).toBe(held.columns.length);
    expect(screen.getByText('Alpha Cloud: the sentence changed.')).toBeInTheDocument();
  });

  it('renders no row, and commits nothing, when the producer says what it said, though every condition is a new object', () => {
    const { problems, commits } = mount([alpha, beta, gamma]);
    expect(rows()).toHaveLength(3);
    const cells = watchCells();
    commits.length = 0;
    act(() => {
      problems.set('p', [alpha, beta, gamma].map(again));
    });
    expect([...cells]).toEqual([]);
    expect(commits).toEqual([]);
  });

  it('renders no row when the last condition goes: the rows before it are as they were', () => {
    const { problems } = mount([alpha, beta, gamma]);
    const cells = watchCells();
    act(() => {
      problems.set('p', [alpha, beta].map(again));
    });
    expect([...cells]).toEqual([]);
    expect(rows()).toHaveLength(2);
  });

  it('renders no row when it is given another open function: the rows do not hold it, the buttons read it', () => {
    const { give } = mount([alpha, beta], vi.fn());
    expect(rows()).toHaveLength(2);
    const cells = watchCells();
    give(vi.fn());
    expect([...cells]).toEqual([]);
  });

  it('hands the table one list of columns, whatever changes (its rows, the open function): the kit renders every row again for a list it has not seen', () => {
    const { problems, give } = mount([alpha, beta]);
    const columns = held.columns;
    expect(columns.length).toBeGreaterThan(0);
    act(() => {
      problems.set('p', [alpha, gamma]);
    });
    give(vi.fn());
    act(() => {
      problems.set('p', [alpha, beta, gamma]);
    });
    expect(held.columns).toBe(columns);
  });

  it('is one commit for two hundred conditions that arrive in one set, as rows are added to the table that shows them', () => {
    const { problems, commits } = mount([alpha]);
    commits.length = 0;
    act(() => {
      problems.set('p', [alpha, ...Array.from({ length: 200 }, (_, index) => condition(`n-${String(index).padStart(3, '0')}`, { label: `Word ${String(index)}`, severity: 'info' }))]);
    });
    expect(commits).toEqual(['update']);
    expect(footer(screen.getByRole('region', { name: 'Problems' }).closest('[data-ov-state]')!)).toBe('201 problems');
  });

  it('is one commit of its own for two hundred conditions that arrive in one set, as the table is drawn for the first time: the table\'s measuring is the only other', () => {
    // The first draw of the kit's table measures its region in a layout effect and renders again before paint (a nested update): that is the table's own, and the same for one row as for two hundred.
    const drawn = (count: number): { readonly commits: string[]; readonly rows: number } => {
      const { problems, commits } = mount();
      commits.length = 0;
      act(() => {
        problems.set('p', Array.from({ length: count }, (_, index) => condition(`n-${String(index).padStart(3, '0')}`, { label: `Word ${String(index)}`, severity: 'info' })));
      });
      const result = { commits: [...commits], rows: rows().length };
      cleanup();
      return result;
    };

    const one = drawn(1);
    const many = drawn(200);
    expect(many.rows).toBeGreaterThan(20);
    expect(many.commits.filter((phase) => phase !== 'nested-update')).toEqual(['update']);
    expect(many.commits).toEqual(one.commits);
  });

  it('holds one listener on the model for as long as it is on screen, however often the model changes, and none after', () => {
    const inner = createProblems();
    let subscribed = 0;
    let live = 0;
    const problems: Problems = {
      ...inner,
      subscribe: (listener) => {
        subscribed += 1;
        live += 1;
        const stop = inner.subscribe(listener);
        return () => {
          live -= 1;
          stop();
        };
      },
    };
    const { view } = mount([alpha], vi.fn(), problems);
    act(() => {
      problems.set('p', [alpha, beta]);
    });
    act(() => {
      problems.set('p', [alpha, beta, gamma]);
    });
    expect([subscribed, live]).toEqual([1, 1]);
    view.unmount();
    expect(live).toBe(0);
  });
});
