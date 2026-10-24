import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, expect, it, vi } from 'vitest';

import { InstanceProvider } from '@/features/instance/InstanceContext';
import headerReducer, { actions } from '@/store/header/slice';
import { HeaderAreaItemType, type HeaderIconLink, type HeaderState } from '@/store/header/types';
import CoreLayoutHeader from '..';

const fixture = vi.hoisted(() => {
  const previousBootstrap = window.__OMNIVIEW_BOOTSTRAP__;
  const identity = Object.freeze({
    schemaVersion: 1 as const,
    instanceID: '58613958-8ec9-4b66-92aa-7c8d28b8eb0e',
    displayName: 'Header profile',
    generation: 'a41c2df9-5315-4a3b-b1b1-9384bbdc2613',
    kind: 'development' as const,
  });
  window.__OMNIVIEW_BOOTSTRAP__ = { identity, storageKey: (key: string) => `${identity.instanceID}:${key}` };
  return { identity, previousBootstrap };
});

vi.mock('@omniviewdev/runtime/api', () => ({
  GetInstanceInfo: async () => ({
    ...fixture.identity,
    workspaceID: 'bb25942b-d05e-4de7-9c4c-8bd39479502f',
    channel: 'local',
    stateRoot: '/disposable/header/state',
    version: 'test',
    commit: 'test',
    readiness: 'ready',
    repositories: [],
    endpoints: { browser: null, vite: null, hmr: null, mcp: null, control: null, health: null },
  }),
}));

afterAll(() => {
  window.__OMNIVIEW_BOOTSTRAP__ = fixture.previousBootstrap;
});

it('keeps development identity and details available when optional header controls are hidden', async () => {
  const item: HeaderIconLink = {
    id: 'optional-settings',
    type: HeaderAreaItemType.LINK,
    icon: 'LuSettings',
    helpText: 'Optional settings tool',
    href: '/settings',
  };
  const header: HeaderState = {
    visible: true,
    areas: {
      left: { visible: true, type: 'items', items: [item] },
      center: { visible: true, type: 'items', items: [] },
      right: { visible: true, type: 'items', items: [] },
    },
  };
  const store = configureStore({ reducer: { header: headerReducer }, preloadedState: { header } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <InstanceProvider><CoreLayoutHeader /></InstanceProvider>
      </MemoryRouter>
    </Provider>,
  );

  expect(screen.getByRole('button', { name: 'Optional settings tool' })).toBeVisible();
  act(() => {
    store.dispatch(actions.setHeaderVisibility(false));
    for (const area of ['left', 'center', 'right'] as const) {
      store.dispatch(actions.setHeaderAreaVisibility({ area, visible: false }));
    }
  });

  expect(screen.queryByRole('button', { name: 'Optional settings tool' })).not.toBeInTheDocument();
  const instanceButton = screen.getByRole('button', { name: 'DEV · Header profile — instance details' });
  expect(instanceButton).toBeVisible();
  await waitFor(() => expect(document.title).toBe('Omniview — DEV · Header profile'));
  fireEvent.click(instanceButton);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(await screen.findByText('Identity confirmed by the host.')).toBeVisible();
  expect(screen.getByText(fixture.identity.instanceID)).toBeVisible();
});
