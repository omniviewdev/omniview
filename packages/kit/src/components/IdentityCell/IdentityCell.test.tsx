import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LinkProvider, type LinkHandler, type LinkTarget } from '../Link';
import { IdentityCell, type IdentityCellProps } from './IdentityCell';

const HANDLER: LinkHandler = { hrefOf: (target) => `#/${target.page}/${target.params?.name ?? ''}`, onOpen: () => undefined };
const TARGET: LinkTarget = { page: 'connections', params: { name: 'connection-a' } };

describe('IdentityCell', () => {
  it('shows the name as text, or as the one link of the cell when it has a destination', () => {
    const { container, rerender } = render(<IdentityCell name="Connection A" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe('Connection A');

    rerender(
      <LinkProvider handler={HANDLER}>
        <IdentityCell name="Connection A" to={TARGET} detail="Platform · production" marks={[{ icon: 'pin', label: 'Pinned' }]} />
      </LinkProvider>,
    );
    const link = screen.getByRole('link', { name: 'Connection A' });
    expect(link.getAttribute('href')).toBe('#/connections/connection-a');
    expect(container.querySelectorAll('a, button, [tabindex]')).toHaveLength(1);
  });

  it('draws a mark as a glyph with its word, which is read and kept out of the name', () => {
    const { container } = render(
      <LinkProvider handler={HANDLER}>
        <IdentityCell name="Connection A" to={TARGET} marks={[{ icon: 'pin', label: 'Pinned' }, { icon: 'eye', label: 'Read-only' }]} />
      </LinkProvider>,
    );
    const marks = [...container.querySelectorAll('[data-ov-part="mark"]')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['Pinned', 'Read-only']);
    for (const mark of marks) {
      expect(mark.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(mark.closest('a')).toBeNull();
    }

    expect(screen.getByRole('link').textContent).toBe('Connection A');
  });

  it('draws the lead and the detail line only when it is given them', () => {
    const { container, rerender } = render(<IdentityCell name="Connection A" />);
    expect(container.querySelector('[data-ov-part="lead"]')).toBeNull();
    expect(container.querySelector('[data-ov-part="detail"]')).toBeNull();

    rerender(<IdentityCell name="Connection A" lead={<span data-testid="lead" />} detail="Platform · production" />);
    expect(container.querySelector('[data-ov-part="lead"]')?.querySelector('[data-testid="lead"]')).not.toBeNull();
    expect(container.querySelector('[data-ov-part="detail"]')?.textContent).toBe('Platform · production');
  });

  it('has closed props: no className, no style, a name that is text', () => {
    // Types only: these are never rendered.
    // @ts-expect-error className is not a prop of a kit part
    const withClass: IdentityCellProps = { name: 'Connection A', className: 'x' };
    // @ts-expect-error a name is text
    const elementName: IdentityCellProps = { name: <b>Connection A</b> };
    // @ts-expect-error a mark names its glyph from the registry
    const unknownGlyph: IdentityCellProps = { name: 'Connection A', marks: [{ icon: 'not-a-glyph', label: 'Pinned' }] };
    expect([withClass, elementName, unknownGlyph]).toHaveLength(3);
  });
});
