import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Runtime from '@omniviewdev/runtime';

import { projectResourceRows } from '../rows';
import { FIXTURE_CONNECTION_ID, FIXTURE_RESOURCE_TYPE, makeHostRecord } from '../testing/fixture';
import { ActionMenuScope, ActionMenuTrigger } from './ActionMenu';

// Only the native mutation transport and the bottom drawer are replaced. The menu, its items and the
// confirmation dialog are the production implementations.
const mutations = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@omniviewdev/runtime', async (original) => ({
  ...await original<typeof Runtime>(),
  useResourceMutations: () => mutations,
}));
vi.mock('@/providers/BottomDrawer/events', () => ({ bottomDrawerChannel: { emit: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function showScope(count: number) {
  const rows = projectResourceRows(Array.from({ length: count }, (_, index) => makeHostRecord(index + 1)));
  render(
    <ActionMenuScope actions={{}} plugin="fixture" connection={FIXTURE_CONNECTION_ID} resource={FIXTURE_RESOURCE_TYPE}>
      {rows.map((row) => <ActionMenuTrigger key={row.record.key} row={row} />)}
    </ActionMenuScope>,
  );
  return rows;
}

describe('resource row actions', () => {
  it('opens one shared menu that acts on the row whose trigger opened it', async () => {
    const user = userEvent.setup();
    const rows = showScope(2);
    const triggers = screen.getAllByRole('button', { name: 'Resource actions' });
    expect(triggers).toHaveLength(2);
    // Rows that were never opened mount no popup.
    expect(screen.queryByRole('menuitem')).toBeNull();

    await user.click(triggers[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText(/delete widgets 'widget-00001'\?/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    await user.click(triggers[1]);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText(/delete widgets 'widget-00002'\?/)).toBeTruthy();
    mutations.mutate.mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mutations.mutate).toHaveBeenCalledTimes(1);
    });
    expect(mutations.mutate).toHaveBeenCalledWith({
      route: rows[1].record.route,
      reference: rows[1].record.record.reference,
      operation: 'delete',
      input: { kind: 'null' },
    });
  });

  it('dismisses the open menu when the page scrolls', async () => {
    const user = userEvent.setup();
    showScope(1);

    await user.click(screen.getByRole('button', { name: 'Resource actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy();

    window.dispatchEvent(new Event('scroll'));

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    });
  });

  it('requires the scope that owns the menu', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [row] = projectResourceRows([makeHostRecord(1)]);

    expect(() => render(<ActionMenuTrigger row={row} />)).toThrow('Resource row actions require ActionMenuScope.');

    error.mockRestore();
  });
});
