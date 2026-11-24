import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';
import { CompactWithAction, NoAction } from './EmptyState.examples';

const words = { icon: 'bell-off', title: 'No notifications', hint: 'Messages from plugins appear here.' } as const;

describe('EmptyState', () => {
  it('shows a decorative glyph and both lines of copy without a button or an announcement', () => {
    const loose = { role: 'status', 'aria-live': 'polite', tabIndex: 0, className: 'override' };
    render(<EmptyState {...words} {...loose} data-testid="empty" />);
    const root = screen.getByTestId('empty');
    expect(root.getAttribute('data-ov-part')).toBe('empty-state');
    expect(root.hasAttribute('data-ov-compact')).toBe(false);
    expect(root.classList.contains('override')).toBe(false);
    expect(root.hasAttribute('aria-live')).toBe(false);
    expect(root.hasAttribute('tabindex')).toBe(false);
    expect(root.querySelector('[data-ov-part="icon"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe(words.icon);
    expect(screen.getByText(words.title).getAttribute('data-ov-variant')).toBe('title');
    expect(screen.getByText(words.hint).getAttribute('data-ov-variant')).toBe('caption');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers one native command in compact mode without submitting the host form or moving focus', () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <EmptyState {...words} compact action={{ label: 'Clear filters', icon: 'close', onSelect }} data-testid="empty" />
      </form>,
    );
    expect(screen.getByTestId('empty').hasAttribute('data-ov-compact')).toBe(true);
    expect(screen.getByText(words.hint).getAttribute('data-ov-variant')).toBe('body');
    const button = screen.getByRole('button', { name: 'Clear filters' });
    expect(screen.getAllByRole('button')).toEqual([button]);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('close');
    button.focus();
    fireEvent.click(button);
    expect(onSelect.mock.calls).toEqual([[]]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });
});

describe('EmptyState examples', () => {
  it('renders a state with nothing to do', () => {
    render(<NoAction />);
    expect(screen.getByText('No notifications')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports activation in the owning view', () => {
    render(<CompactWithAction />);
    expect(screen.getByRole('status').textContent).toBe('Terminal launch requests: 0');
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    expect(screen.getByRole('status').textContent).toBe('Terminal launch requests: 1');
  });
});
