import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconButton } from './IconButton';

// An icon button that opens a menu says so (`aria-haspopup="menu"`), as the mock's `⋯` More actions button does; the menu's own handle writes `aria-expanded` and `aria-controls` on the trigger that is open.

describe('IconButton popup', () => {
  it('says it opens a menu when it is told it does', () => {
    render(<IconButton icon="ellipsis" label="More actions" popup="menu" />);
    expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-haspopup')).toBe('menu');
  });

  it('says nothing of a popup otherwise', () => {
    render(<IconButton icon="ellipsis" label="More actions" />);
    expect(screen.getByRole('button', { name: 'More actions' }).hasAttribute('aria-haspopup')).toBe(false);
  });
});
