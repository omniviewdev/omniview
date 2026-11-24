import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyHint } from './index';

describe('KeyHint', () => {
  it('renders the supplied shortcut as native keyboard text without a binding or a tab stop', () => {
    render(<KeyHint keys="Ctrl+K" data-testid="hint" />);
    const hint = screen.getByTestId('hint');
    expect(hint.tagName).toBe('KBD');
    expect(hint.textContent).toBe('Ctrl+K');
    expect(hint.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(hint.tabIndex).toBe(-1);
  });

  it('isolates only the chord in RTL and exposes the spoken keys with the action label', () => {
    render(
      <>
        <button aria-describedby="hint">Open</button>
        <p id="hint" dir="rtl">
          <KeyHint keys="⌘↵" spokenKeys="Command Enter" label="فتح" data-testid="pair" />
        </p>
      </>,
    );
    const pair = screen.getByTestId('pair');
    const chord = pair.querySelector('kbd');
    expect(chord?.closest('[dir]')).toBe(chord);
    expect(chord?.getAttribute('dir')).toBe('ltr');
    expect(chord?.querySelector('[aria-hidden="true"]')?.textContent).toBe('⌘↵');
    expect(chord?.nextElementSibling).toBe(screen.getByText('فتح'));
    expect(chord?.nextElementSibling?.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('button', { name: 'Open', description: 'Command Enter فتح' })).toBeDefined();
  });
});
