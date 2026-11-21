import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconButton } from '../IconButton';
import { RovingGroup } from './RovingGroup';

// The role of a roving group (P1b-4a). A group is the default. A toolbar is the ARIA pattern of a set of controls that is one Tab stop and moves by arrows (the mock's panel toolbar is `role="toolbar"
// aria-orientation="vertical"`, shell-regions.js 319): the same keys and the same Tab stop, said with the role that names the pattern, and its orientation when it is a column.

describe('RovingGroup\'s role', () => {
  it('is a named group unless it is told it is a toolbar, and says no orientation', () => {
    render(
      <RovingGroup label="Actions">
        <IconButton icon="plus" label="Add" />
      </RovingGroup>,
    );
    const group = screen.getByRole('group', { name: 'Actions' });
    expect(group.hasAttribute('aria-orientation')).toBe(false);
  });

  it('is a named toolbar that says it is vertical when it is a column', () => {
    render(
      <RovingGroup label="Logs tools" kind="column" role="toolbar">
        <IconButton icon="plus" label="Add" />
        <IconButton icon="plus" label="Remove" />
      </RovingGroup>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Logs tools' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    expect(screen.queryByRole('group', { name: 'Logs tools' })).toBeNull();
  });

  it('is a toolbar that says it is horizontal when it is a row', () => {
    render(
      <RovingGroup label="Tools" role="toolbar">
        <IconButton icon="plus" label="Add" />
      </RovingGroup>,
    );
    expect(screen.getByRole('toolbar', { name: 'Tools' }).getAttribute('aria-orientation')).toBe('horizontal');
  });
});
