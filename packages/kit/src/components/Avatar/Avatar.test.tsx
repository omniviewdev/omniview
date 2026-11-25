import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, type AvatarProps } from './Avatar';

const box = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('Avatar', () => {
  it('draws the initials of a name: two words give their first letters, one word its first two', () => {
    const initials: ReadonlyArray<readonly [string, string]> = [
      ['Ada Lovelace', 'AL'],
      ['ada.lovelace', 'AL'],
      ['  north-yard  ', 'NY'],
      ['production', 'PR'],
      ['x', 'X'],
      ['', '?'],
    ];
    for (const [name, expected] of initials) {
      const { container, unmount } = render(<Avatar name={name} />);
      expect(box(container).textContent, name).toBe(expected);
      unmount();
    }
  });

  it('is hidden decoration unless it has a label, and then an image that has that name', () => {
    const { container, rerender } = render(<Avatar name="Ada Lovelace" />);
    expect(box(container).getAttribute('aria-hidden')).toBe('true');
    expect(box(container).hasAttribute('role')).toBe(false);
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<Avatar name="Ada Lovelace" label="Ada Lovelace, owner" />);
    expect(screen.getByRole('img', { name: 'Ada Lovelace, owner' })).toBe(box(container));
    expect(box(container).hasAttribute('aria-hidden')).toBe(false);
  });

  it('takes its tint from the name, the same every time, and a solid fill from a colour', () => {
    const { container, rerender } = render(<Avatar name="Connection A" />);
    expect(box(container)).toHaveProperty('dataset.ovFill', 'tint');
    expect(box(container)).toHaveProperty('dataset.ovColor', 'cyan');
    rerender(<Avatar name="Connection C" />);
    expect(box(container)).toHaveProperty('dataset.ovColor', 'blue');
    rerender(<Avatar name="Connection A" />);
    expect(box(container)).toHaveProperty('dataset.ovColor', 'cyan');

    rerender(<Avatar name="Connection A" color="red" />);
    expect(box(container)).toHaveProperty('dataset.ovFill', 'solid');
    expect(box(container)).toHaveProperty('dataset.ovColor', 'red');
  });

  it('holds a glyph or a picture instead of the initials, and a picture is decoration that decodes off the main thread', () => {
    const { container, rerender } = render(<Avatar name="Connection A" icon="server" />);
    expect(box(container).querySelector('svg')).not.toBeNull();
    expect(box(container).textContent).toBe('');

    rerender(<Avatar name="Connection A" image="data:image/gif;base64,R0lGODlhAQABAAAAACw=" shape="square" size={28} />);
    const picture = box(container).querySelector('img');
    expect(picture?.getAttribute('src')).toBe('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(picture?.getAttribute('decoding')).toBe('async');
    expect(box(container).textContent).toBe('');
    expect(box(container)).toHaveProperty('dataset.ovShape', 'square');
    expect(box(container)).toHaveProperty('dataset.ovSize', '28');
  });

  it('has closed props: one face at a time, and no className or style', () => {
    // Types only: these are never rendered.
    // @ts-expect-error a glyph and a picture are two faces of one box
    const both: AvatarProps = { name: 'A', icon: 'box', image: 'data:,' };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: AvatarProps = { name: 'A', className: 'x' };
    // @ts-expect-error a size outside the closed scale
    const odd: AvatarProps = { name: 'A', size: 18 };
    expect([both, withClass, odd]).toHaveLength(3);
  });
});
