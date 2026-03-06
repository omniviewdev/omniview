import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { PluginContext, type PluginContextType } from '../context/plugins/PluginContext';
import Link from './Link';
import usePluginRouter from './usePluginRouter';

function renderWithPluginContext(ui: React.ReactElement, value: PluginContextType, initialEntry: string) {
  return render(
    <PluginContext.Provider value={value}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {ui}
      </MemoryRouter>
    </PluginContext.Provider>,
  );
}

function HookProbe() {
  const { navigate, pluginPath } = usePluginRouter();
  const location = useLocation();

  return (
    <>
      <button type="button" onClick={() => navigate('/cluster/my-cluster/resources')}>go</button>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="plugin-path">{pluginPath}</div>
    </>
  );
}

describe('router scoping', () => {
  it('usePluginRouter scopes absolute navigation to context pluginId, not meta.id', () => {
    const pluginContext: PluginContextType = {
      pluginId: 'kubernetes',
      // Simulates stale async meta for another plugin.
      meta: { id: 'containers' } as any,
      settings: {},
    };

    renderWithPluginContext(<HookProbe />, pluginContext, '/_plugin/kubernetes/clusters');

    expect(screen.getByTestId('plugin-path').textContent).toBe('/clusters');

    fireEvent.click(screen.getByRole('button', { name: 'go' }));

    expect(screen.getByTestId('pathname').textContent).toBe('/_plugin/kubernetes/cluster/my-cluster/resources');
  });

  it('Link resolves with context pluginId, not meta.id', () => {
    const pluginContext: PluginContextType = {
      pluginId: 'kubernetes',
      // Simulates stale async meta for another plugin.
      meta: { id: 'containers' } as any,
      settings: {},
    };

    renderWithPluginContext(
      <Link to="/cluster/my-cluster/resources">Cluster</Link>,
      pluginContext,
      '/_plugin/kubernetes/clusters',
    );

    const anchor = screen.getByRole('link', { name: 'Cluster' });
    expect(anchor.getAttribute('href')).toBe('/_plugin/kubernetes/cluster/my-cluster/resources');
  });
});
