import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as examples from './IconButton.examples';
import { IconButton, type IconButtonProps } from './IconButton';

const click = (element: HTMLElement) => {
  fireEvent.click(element);
};

describe('IconButton', () => {
  it('is a native button named by its label, which is required and never taken from the glyph', () => {
    render(<IconButton icon="refresh" label="Refresh Pods" />);
    const button = screen.getByRole('button', { name: 'Refresh Pods' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Refresh Pods');
    expect(button.textContent).toBe('');
    expect(button).toHaveProperty('dataset.ovShape', 'icon');
    expect(button).toHaveProperty('dataset.ovVariant', 'secondary');
    expect(button).toHaveProperty('dataset.ovTone', 'neutral');
    expect(button).toHaveProperty('dataset.ovSize', 'standard');
    for (const attribute of ['title', 'style', 'aria-disabled', 'aria-busy', 'aria-describedby', 'disabled', 'tabindex']) {
      expect(button.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('draws one decorative 16 px glyph and nothing else', () => {
    render(<IconButton icon="refresh" label="Refresh" />);
    const button = screen.getByRole('button');
    expect(button.children).toHaveLength(1);
    const svg = button.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('data-ov-glyph')).toBe('refresh');
    expect(svg?.getAttribute('data-ov-size')).toBe('16');
  });

  it('calls onClick once per click', () => {
    const onClick = vi.fn();
    render(<IconButton icon="refresh" label="Refresh" onClick={onClick} />);
    click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('stays focusable and does nothing for a reason, which is its description', () => {
    const onClick = vi.fn();
    render(<IconButton icon="refresh" label="Refresh Pods" disabledReason="Refreshing" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Refresh Pods', description: 'Refreshing' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(fireEvent.click(button)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.querySelector('[hidden]')?.textContent).toBe('Refreshing');
  });

  it('is square: the shape and the size are attributes of its stylesheet', () => {
    render(<IconButton icon="copy" label="Copy name" variant="ghost" tone="danger" size="row" />);
    const button = screen.getByRole('button', { name: 'Copy name' });
    expect(button).toHaveProperty('dataset.ovShape', 'icon');
    expect(button).toHaveProperty('dataset.ovVariant', 'ghost');
    expect(button).toHaveProperty('dataset.ovTone', 'danger');
    expect(button).toHaveProperty('dataset.ovSize', 'row');
  });

  describe('busy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('says aria-busy at once and shows the loader in the same slot after one second', () => {
      render(<IconButton icon="refresh" label="Refresh" busy />);
      const button = screen.getByRole('button', { name: 'Refresh' });
      const glyph = () => button.querySelector('svg')?.getAttribute('data-ov-glyph');
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(glyph()).toBe('refresh');
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(glyph()).toBe('loader');
      expect(button.querySelector('svg')?.getAttribute('data-ov-busy')).toBe('true');
      expect(button.getAttribute('aria-label')).toBe('Refresh');
      expect(button.children).toHaveLength(1);
    });
  });

  it('has the elements it says: a button and a glyph (two for a one-path glyph), one more for a reason', () => {
    const count = (element: React.ReactElement) => {
      const { container, unmount } = render(element);
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };
    expect(count(<IconButton icon="refresh" label="Refresh" />)).toBe(3);
    expect(count(<IconButton icon="status-success" label="Healthy" />)).toBe(4);
    expect(count(<IconButton icon="refresh" label="Refresh" disabledReason="Refreshing" />)).toBe(4);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = IconButton as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { icon: 'refresh', label: 'Go', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', type: 'submit', tabIndex: 5 };
    render(<Loose {...loose} />);
    const button = screen.getByTestId('probe');
    expect(button.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(button.hasAttribute(attribute), attribute).toBe(false);
    }

    expect(button.getAttribute('type')).toBe('button');
  });

  it('has closed props: a glyph, a label, no className, no style, no unnamed icon button', () => {
    // Types only: these are never rendered.
    const accepted: IconButtonProps[] = [
      { icon: 'refresh', label: 'Refresh' },
      { icon: 'refresh', label: 'Refresh', variant: 'ghost', tone: 'danger', size: 'row', busy: true, disabledReason: 'Why', onClick: () => undefined },
    ];
    // @ts-expect-error an icon button needs its name: there is no default from the glyph or an action
    const nameless: IconButtonProps = { icon: 'refresh' };
    // @ts-expect-error an icon button needs its glyph
    const glyphless: IconButtonProps = { label: 'Refresh' };
    // @ts-expect-error an icon outside the registry
    const unknownIcon: IconButtonProps = { icon: 'rocket', label: 'Go' };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: IconButtonProps = { icon: 'refresh', label: 'Go', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: IconButtonProps = { icon: 'refresh', label: 'Go', style: { color: 'red' } };
    // @ts-expect-error the standard and row sizes only: an icon command is a square
    const compact: IconButtonProps = { icon: 'refresh', label: 'Go', size: 'compact' };
    // @ts-expect-error children are not a prop: the name is the label
    const withChildren: IconButtonProps = { icon: 'refresh', label: 'Go', children: 'Go' };
    expect([accepted, nameless, glyphless, unknownIcon, withClass, withStyle, compact, withChildren]).toHaveLength(8);
  });

  it('writes nothing to the document root', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<IconButton icon="refresh" label="Refresh" disabledReason="Refreshing" busy />);
    click(screen.getByRole('button'));
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

type Row = { readonly name: string; readonly description?: string; readonly disabled?: true; readonly busy?: true; readonly icon: string };
const MATRIX: Readonly<Record<string, Row>> = {
  Secondary: { name: 'Refresh Pods', icon: 'refresh' },
  Ghost: { name: 'Refresh Pods', icon: 'refresh' },
  Primary: { name: 'Refresh Pods', icon: 'refresh' },
  Danger: { name: 'Clear selection', icon: 'close' },
  GhostDanger: { name: 'Clear selection', icon: 'close' },
  SecondaryDisabled: { name: 'Refresh Pods', description: 'Refreshing', disabled: true, icon: 'refresh' },
  GhostDisabled: { name: 'Refresh Pods', description: 'Refreshing', disabled: true, icon: 'refresh' },
  DisabledWithVisibleReason: { name: 'Refresh Pods', description: 'Refreshing', disabled: true, icon: 'refresh' },
  Busy: { name: 'Refresh Pods', busy: true, icon: 'refresh' },
  Row: { name: 'Copy name', icon: 'copy' },
  RowGhost: { name: 'Copy name', icon: 'copy' },
};

describe('IconButton examples: the a11y matrix', () => {
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
      expect(screen.getAllByRole('button')).toHaveLength(1);
      const button = screen.getByRole('button', { name: row.name, ...(row.description === undefined ? {} : { description: row.description }) });
      expect(button.getAttribute('aria-label')).toBe(row.name);
      expect(button.textContent).toBe(row.description === undefined ? '' : row.description);
      expect(button.getAttribute('aria-disabled') === 'true').toBe(row.disabled === true);
      expect(button.getAttribute('aria-busy') === 'true').toBe(row.busy === true);
      expect(button.hasAttribute('disabled')).toBe(false);
      expect(button.querySelectorAll('svg')).toHaveLength(1);
      expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe(row.icon);
      expect(document.querySelector('[title]')).toBeNull();
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  }

  it('shows the reason as text beside the control, not only as its description (P2)', () => {
    render(<examples.DisabledWithVisibleReason />);
    const visible = screen.getByText('Refreshing', { selector: 'span:not([hidden])' });
    expect(visible).toBeVisible();
    expect(screen.getByRole('button').contains(visible)).toBe(false);
  });
});
