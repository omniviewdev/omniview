import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Disclosure } from './Disclosure';
import * as examples from './Disclosure.examples';

describe('Disclosure', () => {
  it('holds one native button in an h3, or an h4, with aria-expanded; lead and aside are siblings of the heading, not inside it', () => {
    const { container, rerender } = render(
      <Disclosure title="Rule" meta="2" lead={<button type="button">Select</button>} aside={<button type="button">Remove</button>} />,
    );
    const heading = screen.getByRole('heading', { name: /^Rule/ });
    expect(heading.tagName).toBe('H3');
    const trigger = screen.getByRole('button', { name: /^Rule/ });
    expect(trigger.parentElement).toBe(heading);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('button')).toBeNull();
    const bar = container.querySelector('[data-ov-part="bar"]')!;
    expect([...bar.children].map((child) => child.tagName)).toEqual(['DIV', 'H3', 'DIV']);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Select', 'Rule2', 'Remove']);
    rerender(<Disclosure title="Rule" level={4} />);
    expect(screen.getByRole('heading').tagName).toBe('H4');
  });

  it('mounts the body only while open, as a region named by the trigger that aria-controls names', () => {
    render(<Disclosure title="Rule">detail</Disclosure>);
    const trigger = screen.getByRole('button', { name: 'Rule' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const region = screen.getByRole('region', { name: 'Rule' });
    expect(region.textContent).toBe('detail');
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    fireEvent.click(trigger);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('starts open with `defaultOpen` and reports each change', () => {
    const onOpenChange = vi.fn();
    render(
      <Disclosure title="Rule" defaultOpen onOpenChange={onOpenChange}>
        detail
      </Disclosure>,
    );
    expect(screen.getByRole('region')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Rule' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows only what it is told when `open` is given: the change is reported, not applied', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure title="Rule" open={false} onOpenChange={onOpenChange}>
        detail
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rule' }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole('region')).toBeNull();
    rerender(
      <Disclosure title="Rule" open onOpenChange={onOpenChange}>
        detail
      </Disclosure>,
    );
    expect(screen.getByRole('region').textContent).toBe('detail');
  });

  it('draws the meta inside the trigger, after the title, and none when it is empty', () => {
    const { rerender } = render(<Disclosure title="Rule" meta="Review rule" />);
    const trigger = screen.getByRole('button');
    expect(trigger.querySelector('[data-ov-part="meta"]')?.textContent).toBe('Review rule');
    rerender(<Disclosure title="Rule" meta="" />);
    expect(trigger.querySelector('[data-ov-part="meta"]')).toBeNull();
  });

  it('renders every example with a trigger, in no more than the roles it says', () => {
    for (const [name, Example] of Object.entries(examples as Record<string, () => ReactElement>)) {
      const { container, unmount } = render(<Example />);
      expect(container.querySelector('button[aria-expanded]'), name).not.toBeNull();
      expect(container.querySelector('[title]'), name).toBeNull();
      unmount();
    }
  });
});
