import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuHost, useMenu } from '../Menu';
import { ToolHeader } from './ToolHeader';

describe('ToolHeader', () => {
  it('is a group named by its label, with the title as a heading, and no toolbar when there are no actions', () => {
    render(<ToolHeader label="Connections" title="Saved connections" />);
    expect(screen.getByRole('group', { name: 'Connections' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Saved connections' }).hasAttribute('data-ov-clip')).toBe(true);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('puts the actions in one toolbar that is one Tab stop and moves by the arrow keys', () => {
    const onRefresh = vi.fn();
    render(
      <ToolHeader
        label="Connections"
        title="Connections"
        actions={[
          { id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect: onRefresh },
          { id: 'add', label: 'Add connection', icon: 'plus', onSelect: () => undefined },
        ]}
      />,
    );
    expect(screen.getByRole('toolbar', { name: 'Connections actions' })).toBeDefined();
    const refresh = screen.getByRole('button', { name: 'Refresh connections' });
    const add = screen.getByRole('button', { name: 'Add connection' });
    expect([refresh.tabIndex, add.tabIndex]).toEqual([0, -1]);
    refresh.focus();
    fireEvent.keyDown(refresh, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(add);
    expect([refresh.tabIndex, add.tabIndex]).toEqual([-1, 0]);
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps an unavailable action focusable, does nothing on click, and describes it with its reason', () => {
    const onSelect = vi.fn();
    render(<ToolHeader label="Connections" title="Connections" actions={[{ id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect, disabledReason: 'Connections are loading.' }]} />);
    const button = screen.getByRole('button', { name: 'Refresh connections' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button).toHaveProperty('disabled', false);
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('makes a menu action a trigger of the menu its owner registered', () => {
    function Owner() {
      const menu = useMenu(() => [{ kind: 'action', id: 'organize', label: 'Organize', onSelect: () => undefined }]);
      return <ToolHeader label="Connections" title="Connections" actions={[{ id: 'more', label: 'Organize connections', icon: 'ellipsis', menu }]} />;
    }

    render(
      <MenuHost>
        <Owner />
      </MenuHost>,
    );
    const trigger = screen.getByRole('button', { name: 'Organize connections' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('data-ov-menu')).not.toBeNull();
  });
});
