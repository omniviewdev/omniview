import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileButton } from './FileButton';

const picker = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="file"]')!;

const pick = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  fireEvent.change(input);
};

describe('FileButton', () => {
  it('is one button that opens the picker, which is a hidden input with the accept list and the multiple flag', () => {
    const { container } = render(
      <FileButton accept={['image/png', 'image/webp']} multiple onFiles={() => undefined}>
        Import image…
      </FileButton>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const input = picker(container);
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('accept')).toBe('image/png,image/webp');
    expect(input.multiple).toBe(true);
    const open = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Import image…' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('reports the picked files as they are, and nothing when none were picked', () => {
    const onFiles = vi.fn();
    const { container } = render(<FileButton onFiles={onFiles}>Import image…</FileButton>);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    pick(picker(container), [file]);
    expect(onFiles).toHaveBeenCalledWith([file]);
    pick(picker(container), []);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it('opens no picker while it is unavailable for a reason or busy, and stays focusable with its reason', () => {
    const { container, rerender } = render(
      <FileButton disabledReason="Save the item first." onFiles={() => undefined}>
        Import image…
      </FileButton>,
    );
    const open = vi.spyOn(picker(container), 'click');
    const button = screen.getByRole('button', { name: 'Import image…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    rerender(
      <FileButton busy onFiles={() => undefined}>
        Import image…
      </FileButton>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
    expect(open).not.toHaveBeenCalled();
  });
});
