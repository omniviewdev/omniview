import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { LinkProvider, type LinkHandler } from '../Link';
import { MenuHost, useMenu } from '../Menu';
import { ResourceCard, type ResourceCardProps } from './ResourceCard';
import * as examples from './ResourceCard.examples';

const TARGET = { page: 'connection', params: { id: 'connection-a' } };

const handler = (onOpen: LinkHandler['onOpen'] = () => undefined): LinkHandler => ({ hrefOf: (target) => `#/${target.page}/${target.params?.id ?? ''}`, onOpen });

const METRICS = [
  { label: 'Platform', value: 'Generic' },
  { label: 'Region', value: 'us-east-1' },
  { label: 'Version', value: '1.31.2' },
];

const card = (props: Partial<ResourceCardProps> = {}) => <ResourceCard title="Connection A" {...props} />;
const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe('ResourceCard', () => {
  it('is the title, its status, one muted line and the facts as labelled values, in one box that takes data attributes', () => {
    const { container } = render(
      card({ lead: <span data-testid="lead" />, status: <span>Connected</span>, meta: 'production', metrics: METRICS, 'data-testid': 'card' }),
    );
    const box = within(screen.getByTestId('card'));
    expect(screen.getByTestId('card')).toBe(root(container));
    expect(box.getByText('Connection A')).toBeTruthy();
    expect(box.getByText('Connected')).toBeTruthy();
    expect(box.getByText('production')).toBeTruthy();
    expect(box.getByTestId('lead')).toBeTruthy();
    expect(box.getAllByRole('term').map((term) => term.textContent)).toEqual(['Platform', 'Region', 'Version']);
    expect(box.getAllByRole('definition').map((value) => value.textContent)).toEqual(['Generic', 'us-east-1', '1.31.2']);
    expect(container.querySelector('[title], [style], [tabindex]')).toBeNull();
  });

  it('draws only what it is given: no facts, no commands and no muted line leave no empty list, footer or line', () => {
    const { container } = render(card());
    expect(root(container).textContent).toBe('Connection A');
    expect(container.querySelector('dl, [data-ov-part="actions"], [data-ov-part="meta"]')).toBeNull();
    expect(screen.queryByRole('term')).toBeNull();
  });

  it('makes the title the one link and the commands its siblings: the Tab stops are the link and the commands, and no control nests in another', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <LinkProvider handler={handler(onOpen)}>
        {card({
          to: TARGET,
          actions: (
            <>
              <Button size="row">Open</Button>
              <IconButton size="row" icon="ellipsis" label="More actions" />
            </>
          ),
        })}
      </LinkProvider>,
    );
    const controls = [...container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')];
    expect(controls.map((control) => control.getAttribute('aria-label') ?? control.textContent)).toEqual(['Connection A', 'Open', 'More actions']);
    for (const control of controls) {
      expect(control.querySelector('a, button'), control.outerHTML).toBeNull();
    }

    const link = screen.getByRole('link', { name: 'Connection A' });
    expect(link.getAttribute('href')).toBe('#/connection/connection-a');
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toEqual(TARGET);
  });

  it('is a context trigger of the view\'s one menu, keyed by its record, from the keyboard on the title and on a command and by secondary click', () => {
    const resolve = vi.fn((key: string | undefined) => (key === undefined ? [] : [{ kind: 'action' as const, id: 'open', label: `Open ${key}`, onSelect: () => undefined }]));
    function View() {
      const menu = useMenu(resolve);
      return (
        <ResourceCard
          title="Connection A"
          to={TARGET}
          menu={{ id: menu, key: 'connection-a' }}
          actions={<Button size="row">Open</Button>}
        />
      );
    }

    render(
      <LinkProvider handler={handler()}>
        <MenuHost>
          <View />
        </MenuHost>
      </LinkProvider>,
    );
    expect(resolve).not.toHaveBeenCalled();
    const open = () => screen.getByRole('menu', { name: 'Actions for Connection A' });
    const close = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    const link = screen.getByRole('link', { name: 'Connection A' });
    link.focus();
    fireEvent.keyDown(link, { key: 'F10', shiftKey: true });
    expect(within(open()).getByRole('menuitem', { name: 'Open connection-a' })).toBeTruthy();
    close();
    expect(screen.queryByRole('menu')).toBeNull();
    // The card is not focusable: focus goes back to the control the menu was opened from.
    expect(document.activeElement).toBe(link);

    const command = screen.getByRole('button', { name: 'Open' });
    command.focus();
    fireEvent.keyDown(command, { key: 'ContextMenu' });
    expect(open()).toBeTruthy();
    close();
    expect(document.activeElement).toBe(command);

    fireEvent.contextMenu(screen.getByText('Connection A'));
    expect(open()).toBeTruthy();
    expect(resolve.mock.calls.every(([key]) => key === 'connection-a')).toBe(true);
  });

  it('holds at most three facts: a fourth is a defect of the caller, not a squeezed column', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(card({ metrics: [...METRICS, { label: 'Nodes', value: '3' }] }))).toThrow(/at most 3 metrics/);
      expect(() => render(card({ metrics: METRICS }))).not.toThrow();
    } finally {
      log.mockRestore();
    }
  });

  it('has examples that all draw a card, with no title attribute and no inline style', () => {
    const entries = Object.entries(examples) as Array<[string, ComponentType]>;
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [name, Example] of entries) {
      const { container, unmount } = render(<Example />);
      expect(container.querySelector('[data-ov-part="resource-card"]'), name).not.toBeNull();
      expect(container.querySelector('[title], [style]'), name).toBeNull();
      unmount();
    }
  });
});
