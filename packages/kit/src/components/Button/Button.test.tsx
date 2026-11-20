import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as examples from './Button.examples';
import { Button, type ButtonProps } from './Button';

const click = (element: HTMLElement) => {
  fireEvent.click(element);
};

describe('Button', () => {
  it('is a native button named by its own text', () => {
    render(<Button>Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button).toHaveProperty('dataset.ovVariant', 'secondary');
    expect(button).toHaveProperty('dataset.ovTone', 'neutral');
    expect(button).toHaveProperty('dataset.ovSize', 'standard');
    for (const attribute of ['title', 'style', 'aria-disabled', 'aria-busy', 'aria-describedby', 'disabled', 'tabindex']) {
      expect(button.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('never submits a form: it is a command, not a submitter', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button>Apply</Button>
      </form>,
    );
    click(screen.getByRole('button', { name: 'Apply' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onClick once per click, with the click event', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create</Button>);
    click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toHaveProperty('type', 'click');
  });

  it('turns variant, tone and size into data attributes for its stylesheet', () => {
    render(
      <Button variant="primary" tone="danger" size="row">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveProperty('dataset.ovVariant', 'primary');
    expect(button).toHaveProperty('dataset.ovTone', 'danger');
    expect(button).toHaveProperty('dataset.ovSize', 'row');
  });

  describe('unavailable for a reason', () => {
    it('stays focusable, says it is unavailable, and does nothing', () => {
      const onClick = vi.fn();
      render(
        <Button disabledReason="Refreshing" onClick={onClick}>
          Refresh
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Refresh' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button).toHaveProperty('disabled', false);
      button.focus();
      expect(document.activeElement).toBe(button);
      click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('is not a submitter either, and its click default is cancelled', () => {
      const onSubmit = vi.fn();
      render(
        <form onSubmit={onSubmit}>
          <Button disabledReason="Nothing to apply">Apply</Button>
        </form>,
      );
      const notPrevented = fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(notPrevented).toBe(false);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('gives its reason as its description, and the reason never becomes part of its name', () => {
      render(<Button disabledReason="Choose a project first">Delete</Button>);
      const button = screen.getByRole('button', { name: 'Delete', description: 'Choose a project first' });
      const reason = button.querySelector('[hidden]');
      expect(reason?.textContent).toBe('Choose a project first');
      expect(button.getAttribute('aria-describedby')).toBe(reason?.getAttribute('id'));
      expect(button.hasAttribute('title')).toBe(false);
    });

    it('takes an empty reason for no reason: the button is available', () => {
      const onClick = vi.fn();
      render(
        <Button disabledReason="" onClick={onClick}>
          Run
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Run' });
      expect(button.hasAttribute('aria-disabled')).toBe(false);
      expect(button.hasAttribute('aria-describedby')).toBe(false);
      click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('is available again when the reason goes away', () => {
      const onClick = vi.fn();
      const { rerender } = render(
        <Button disabledReason="Refreshing" onClick={onClick}>
          Refresh
        </Button>,
      );
      click(screen.getByRole('button'));
      rerender(<Button onClick={onClick}>Refresh</Button>);
      const button = screen.getByRole('button', { name: 'Refresh' });
      expect(button.hasAttribute('aria-disabled')).toBe(false);
      click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('with an icon', () => {
    it('draws a decorative 16 px glyph before the label, and the name stays the text', () => {
      render(<Button icon="columns">Columns</Button>);
      const button = screen.getByRole('button', { name: 'Columns' });
      const [first] = button.childNodes;
      expect(first).toBeInstanceOf(SVGElement);
      expect((first as SVGElement).getAttribute('aria-hidden')).toBe('true');
      expect((first as SVGElement).getAttribute('data-ov-glyph')).toBe('columns');
      expect((first as SVGElement).getAttribute('data-ov-size')).toBe('16');
      expect(button.textContent).toBe('Columns');
    });
  });

  describe('busy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says aria-busy at once, and replaces its icon with the loader after one second; the label never changes', () => {
      render(
        <Button icon="refresh" busy>
          Refresh
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Refresh' });
      expect(button.getAttribute('aria-busy')).toBe('true');
      const glyph = () => button.querySelector('svg')?.getAttribute('data-ov-glyph');
      expect(glyph()).toBe('refresh');
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(glyph()).toBe('refresh');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(glyph()).toBe('loader');
      expect(button.querySelector('svg')?.getAttribute('data-ov-busy')).toBe('true');
      expect(button.textContent).toBe('Refresh');
      expect(screen.getByRole('button', { name: 'Refresh' })).toBe(button);
    });

    it('is quiet again when the request ends: the icon returns and aria-busy goes', () => {
      const { rerender } = render(
        <Button icon="refresh" busy>
          Refresh
        </Button>,
      );
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      rerender(<Button icon="refresh">Refresh</Button>);
      const button = screen.getByRole('button', { name: 'Refresh' });
      expect(button.hasAttribute('aria-busy')).toBe(false);
      expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('refresh');
      expect(button.querySelector('svg')?.hasAttribute('data-ov-busy')).toBe(false);
    });

    it('does not show a loader for a request that ends within the second', () => {
      const { rerender } = render(
        <Button icon="refresh" busy>
          Refresh
        </Button>,
      );
      act(() => {
        vi.advanceTimersByTime(600);
      });
      rerender(<Button icon="refresh">Refresh</Button>);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByRole('button').querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('refresh');
    });

    it('has no icon to replace without one: only aria-busy, and the face does not change', () => {
      render(<Button busy>Save</Button>);
      const button = screen.getByRole('button', { name: 'Save' });
      const before = button.innerHTML;
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.innerHTML).toBe(before);
    });

    it('does not block input: a busy button still takes a click', () => {
      const onClick = vi.fn();
      render(
        <Button busy onClick={onClick}>
          Save
        </Button>,
      );
      click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('leaves no timer behind when it unmounts while busy', () => {
      const { unmount } = render(<Button busy>Save</Button>);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('has the elements it says: one for a text button, three with an icon, one more for a reason', () => {
    const count = (element: React.ReactElement) => {
      const { container, unmount } = render(element);
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };

    expect(count(<Button>Cancel</Button>)).toBe(1);
    expect(count(<Button icon="columns">Columns</Button>)).toBe(3);
    expect(count(<Button icon="columns" busy>Columns</Button>)).toBe(3);
    expect(count(<Button disabledReason="Refreshing">Cancel</Button>)).toBe(2);
    expect(count(<Button icon="columns" disabledReason="Refreshing">Columns</Button>)).toBe(4);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = Button as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { children: 'Go', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', type: 'submit', tabIndex: 5 };
    render(<Loose {...loose} />);
    const button = screen.getByTestId('probe');
    expect(button.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(button.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(button.getAttribute('type')).toBe('button');
  });

  it('has closed props: no className, no style, a label that is text, values of the scales', () => {
    // Types only: these are never rendered.
    const accepted: ButtonProps[] = [
      { children: 'Go' },
      { children: 'Go', variant: 'primary', tone: 'danger', size: 'compact', icon: 'close', busy: true, disabledReason: 'Why', onClick: () => undefined },
      { children: 'Go', variant: undefined, icon: undefined, disabledReason: undefined, busy: undefined, onClick: undefined },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: ButtonProps = { children: 'Go', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: ButtonProps = { children: 'Go', style: { color: 'red' } };
    // @ts-expect-error a variant outside the closed set
    const unknownVariant: ButtonProps = { children: 'Go', variant: 'blue' };
    // @ts-expect-error a tone outside the closed set
    const unknownTone: ButtonProps = { children: 'Go', tone: 'success' };
    // @ts-expect-error a size outside the closed set
    const unknownSize: ButtonProps = { children: 'Go', size: 'huge' };
    // @ts-expect-error an icon outside the registry
    const unknownIcon: ButtonProps = { children: 'Go', icon: 'sparkles' };
    // @ts-expect-error a label is text, not an element: a face holds no status, count or timer
    const elementLabel: ButtonProps = { children: <b>Go</b> };
    // @ts-expect-error a native disabled attribute is not a prop: a button is unavailable for a reason
    const nativeDisabled: ButtonProps = { children: 'Go', disabled: true };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: ButtonProps = { children: 'Go', title: 'hint' };
    expect([accepted, withClass, withStyle, unknownVariant, unknownTone, unknownSize, unknownIcon, elementLabel, nativeDisabled, withTitle]).toHaveLength(10);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    vi.useFakeTimers();
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    const { rerender } = render(<Button icon="refresh">Refresh</Button>);
    click(screen.getByRole('button'));
    rerender(
      <Button icon="refresh" busy disabledReason="Refreshing">
        Refresh
      </Button>,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    observer.disconnect();
    vi.useRealTimers();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a Button is shown in.
type Row = { readonly name: string; readonly description?: string; readonly disabled?: true; readonly busy?: true; readonly icon?: string };
const MATRIX: Readonly<Record<string, Row>> = {
  Secondary: { name: 'Cancel' },
  SecondaryCompact: { name: 'Cancel' },
  Primary: { name: 'Create' },
  PrimaryCompact: { name: 'Create' },
  Ghost: { name: 'Cancel' },
  GhostCompact: { name: 'Cancel' },
  Danger: { name: 'Delete' },
  DangerCompact: { name: 'Delete' },
  PrimaryDanger: { name: 'Delete' },
  GhostCompactDanger: { name: 'Delete' },
  WithIcon: { name: 'Columns', icon: 'columns' },
  ClearFilters: { name: 'Clear filters', icon: 'close' },
  PrimaryWithIcon: { name: 'Connect', icon: 'server' },
  LoadMore: { name: 'Load more', icon: 'chevron-down' },
  SecondaryDisabled: { name: 'Cancel', description: 'Refreshing', disabled: true },
  PrimaryDisabled: { name: 'Create', description: 'Refreshing', disabled: true },
  GhostCompactDisabled: { name: 'Cancel', description: 'Refreshing', disabled: true },
  DangerDisabled: { name: 'Delete', description: 'Refreshing', disabled: true },
  PrimaryDangerDisabled: { name: 'Delete', description: 'Refreshing', disabled: true },
  WithIconDisabled: { name: 'Columns', description: 'Refreshing', disabled: true, icon: 'columns' },
  DisabledWithVisibleReason: { name: 'Refresh', description: 'Refreshing', disabled: true, icon: 'refresh' },
  Busy: { name: 'Refresh', busy: true, icon: 'refresh' },
  BusyWithoutIcon: { name: 'Save', busy: true },
  Row: { name: 'Retry' },
  RowGhost: { name: 'Retry' },
};

describe('Button examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => React.ReactElement>)[exampleName];
    it(`${exampleName}: one button named ${row.name}${row.description === undefined ? '' : ', described by its reason'}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      const button = screen.getByRole('button', { name: row.name, ...(row.description === undefined ? {} : { description: row.description }) });
      expect(button.getAttribute('type')).toBe('button');
      // states
      expect(button.getAttribute('aria-disabled') === 'true').toBe(row.disabled === true);
      expect(button.getAttribute('aria-busy') === 'true').toBe(row.busy === true);
      expect(button.hasAttribute('disabled')).toBe(false);
      // an icon is decorative and is the only svg
      const svgs = button.querySelectorAll('svg');
      expect(svgs.length).toBe(row.icon === undefined ? 0 : 1);
      expect(svgs[0]?.getAttribute('data-ov-glyph')).toBe(row.icon);
      // names come from the face, never from a title or a tooltip attribute
      expect(document.querySelector('[title]')).toBeNull();
      // keyboard: reachable by Tab, available or not
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  }

  it('shows the reason as text beside the control, not only as its description (P2)', () => {
    render(<examples.DisabledWithVisibleReason />);
    const visible = screen.getByText('Refreshing', { selector: 'span:not([hidden])' });
    expect(visible.closest('[hidden]')).toBeNull();
    expect(screen.getByRole('button').contains(visible)).toBe(false);
  });
});
