import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { State, StateKind } from './core/types';
import { roleOf, StateChip } from './StateChip';

// The chip of a plugin's state: the kit's glyph for its role, and the host's word. A plugin that runs has none.

const state = (kind: StateKind, word: string, patch: Partial<State> = {}): State => ({ kind, word, tone: 'neutral', busy: false, cause: undefined, title: '', sentence: '', faulted: false, ...patch });

describe('roleOf', () => {
  it.each<[StateKind, string]>([
    ['running', 'healthy'],
    ['starting', 'progress'],
    ['stopping', 'progress'],
    ['removing', 'progress'],
    ['degraded', 'attention'],
    ['unknown', 'attention'],
    ['disabled', 'stopped'],
    ['stopped', 'stopped'],
    ['failed', 'error'],
    ['incompatible', 'error'],
  ])('a plugin that is %s is drawn with the role %s', (kind, role) => {
    expect(roleOf(state(kind, 'x'))).toBe(role);
  });
});

describe('StateChip', () => {
  it('says the host\'s word with the glyph of its role', () => {
    render(<StateChip state={state('failed', 'Did not start')} />);

    const chip = screen.getByText('Did not start');
    expect(chip.closest('[data-ov-role]')?.getAttribute('data-ov-role')).toBe('error');
    expect(chip.closest('[data-pl-part]')?.getAttribute('data-pl-part')).toBe('state-chip');
  });

  it('is nothing for a plugin that is running: a healthy plugin has no state to say', () => {
    const { container } = render(<StateChip state={state('running', '')} />);

    expect(container).toBeEmptyDOMElement();
  });
});
