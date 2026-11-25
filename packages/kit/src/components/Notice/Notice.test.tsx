import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Notice, type NoticeProps } from './Notice';
import * as examples from './Notice.examples';

describe('Notice', () => {
  it('is plain content unless it is told to be a live region', () => {
    const { container, rerender } = render(<Notice>Saved.</Notice>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute('role')).toBe(false);
    expect(root.textContent).toBe('Saved.');
    rerender(<Notice live="alert">Saved.</Notice>);
    expect(screen.getByRole('alert').textContent).toBe('Saved.');
    rerender(<Notice live="status">Saved.</Notice>);
    expect(screen.getByRole('status').textContent).toBe('Saved.');
  });

  it('draws the status glyph of its tone, info by default, hidden from assistive technology', () => {
    const { container, rerender } = render(<Notice>Saved.</Notice>);
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-info');
    for (const tone of ['success', 'warning', 'error'] as const) {
      rerender(<Notice tone={tone}>Saved.</Notice>);
      const glyph = container.querySelector('svg')!;
      expect(glyph.getAttribute('data-ov-glyph')).toBe(`status-${tone}`);
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('puts a bold title before the message and draws none without one', () => {
    const { container, rerender } = render(<Notice title="Not saved.">Check the name.</Notice>);
    expect(container.querySelector('strong')?.textContent).toBe('Not saved.');
    expect(container.querySelector('[data-ov-part="message"]')?.textContent).toBe('Not saved. Check the name.');
    rerender(<Notice title="">Check the name.</Notice>);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('[data-ov-part="message"]')?.textContent).toBe('Check the name.');
  });

  it('puts its actions after the message, as Tab stops, and draws no group without any', () => {
    const { container, rerender } = render(<Notice actions={<button type="button">Retry</button>}>Failed.</Notice>);
    const actions = container.querySelector('[data-ov-part="actions"]')!;
    expect(container.firstElementChild?.lastElementChild).toBe(actions);
    expect(screen.getByRole('button', { name: 'Retry' }).tabIndex).toBe(0);
    rerender(<Notice>Failed.</Notice>);
    expect(container.querySelector('[data-ov-part="actions"]')).toBeNull();
  });

  it('has closed props: a string message, no className, no style', () => {
    // Types only: these are never rendered.
    // @ts-expect-error className is not a prop of a kit part
    const withClass: NoticeProps = { children: 'x', className: 'x' };
    // @ts-expect-error the message is text, not an element
    const element: NoticeProps = { children: <b>x</b> };
    // @ts-expect-error a tone is one of the four
    const tone: NoticeProps = { children: 'x', tone: 'muted' };
    expect([withClass, element, tone]).toHaveLength(3);
  });

  it('renders every example with a message and no title attribute', () => {
    for (const [name, Example] of Object.entries(examples as Record<string, () => ReactElement>)) {
      const { container, unmount } = render(<Example />);
      expect(container.querySelector('[data-ov-part="message"]')?.textContent, name).not.toBe('');
      expect(container.querySelector('[title]'), name).toBeNull();
      unmount();
    }
  });
});
