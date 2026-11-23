import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { menuTrigger } from '../Menu';
import { IconButton } from './IconButton';

// The button says it opens a menu. The shared host owns expanded and controls state while the menu is open.

describe('IconButton popup', () => {
  it('says it opens a menu with the dropdown trigger attributes', () => {
    render(<IconButton icon="ellipsis" label="More actions" {...menuTrigger('actions')} />);
    expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-haspopup')).toBe('menu');
  });

  it('does not advertise a context trigger as a menu button', () => {
    render(<IconButton icon="ellipsis" label="More actions" {...menuTrigger('actions', undefined, 'context')} />);
    expect(screen.getByRole('button', { name: 'More actions' }).hasAttribute('aria-haspopup')).toBe(false);
  });

  it('says nothing of a popup otherwise', () => {
    render(<IconButton icon="ellipsis" label="More actions" />);
    expect(screen.getByRole('button', { name: 'More actions' }).hasAttribute('aria-haspopup')).toBe(false);
  });
});
