import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShellLaneFace, ShellScopePicker } from './registration';
import { ScopeLane } from './ScopeLane';

// The lane's faces: a face the host gave no picker is text, as it always was; one that has a picker is a button with a chevron.

afterEach(cleanup);

const picker: ShellScopePicker = {
  title: 'Connections',
  placeholder: 'Search connections',
  empty: 'No connections',
  icon: 'server',
  options: [{ id: 'north', label: 'north', state: { role: 'healthy', word: 'Connected' } }],
  current: 'north',
  onChoose: vi.fn(),
};

const plain: ShellLaneFace = { label: 'Scope', icon: 'folder-tree', text: 'Everything' };
const control: ShellLaneFace = { label: 'Connection', icon: 'server', text: 'north', picker };

describe('a face without a picker', () => {
  it('is text read with what it is: no button, no popup, no chevron', () => {
    render(<ScopeLane label="Acme scope" faces={[plain]} />);
    const lane = screen.getByRole('group', { name: 'Acme scope' });

    expect(lane).toHaveTextContent('Scope: Everything');
    expect(within(lane).queryAllByRole('button')).toHaveLength(0);
    const face = lane.querySelector('[data-shell-part="scopeFace"]');
    expect(face?.tagName).toBe('SPAN');
    expect(face).toHaveAttribute('data-ov-tip', 'Everything');
    expect(face?.querySelectorAll('svg')).toHaveLength(1);
    expect(face?.querySelector('[data-ov-glyph="chevron-down"]')).toBeNull();
    expect(face).not.toHaveAttribute('aria-haspopup');
  });

  it('leaves no element or space when the registration withdraws or omits its faces', () => {
    const { container, rerender } = render(<ScopeLane label="Acme scope" faces={[plain]} />);
    expect(screen.getByRole('group', { name: 'Acme scope' })).toBeInTheDocument();

    rerender(<ScopeLane label="Acme scope" faces={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ScopeLane label="Acme scope" faces={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a face with a picker', () => {
  it('is one native button that is a Tab stop, named by what it is and its value, with a popup it names and says is closed', () => {
    render(<ScopeLane label="Acme scope" faces={[control]} />);
    const lane = screen.getByRole('group', { name: 'Acme scope' });
    const buttons = within(lane).getAllByRole('button');

    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    expect(button?.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAccessibleName('Connection: north');
    expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(button?.tabIndex).toBe(0);
    expect(button).toHaveAttribute('data-shell-part', 'scopeFace');
  });

  it('has the full value as its tip, a 16 px glyph and a 12 px chevron after the value', () => {
    render(<ScopeLane label="Acme scope" faces={[control]} />);
    const button = screen.getByRole('button', { name: 'Connection: north' });
    const glyphs = [...button.querySelectorAll('svg')];

    expect(button).toHaveAttribute('data-ov-tip', 'north');
    expect(glyphs.map((glyph) => [glyph.getAttribute('data-ov-glyph'), glyph.getAttribute('data-ov-size')])).toEqual([['server', '16'], ['chevron-down', '12']]);
    expect(button.lastElementChild?.querySelector('svg')).toBe(glyphs[1]);
  });

  it('is a button only where the host gave a picker: a lane of a plain face and a control has one button', () => {
    render(<ScopeLane label="Acme scope" faces={[control, plain]} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Acme scope' })).toHaveTextContent('Scope: Everything');
  });

  it('is text again when the host takes the picker away', () => {
    const { rerender } = render(<ScopeLane label="Acme scope" faces={[control]} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);

    rerender(<ScopeLane label="Acme scope" faces={[{ ...control, picker: undefined }]} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Acme scope' })).toHaveTextContent('Connection: north');
  });
});
