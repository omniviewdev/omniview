import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { normalizePluginRoutes } from './normalizePluginRoutes';

function PluginLayout() {
  return <div><nav>Plugin navigation</nav><Outlet /></div>;
}

function CrashingPage(): never {
  throw new Error('route render failed');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('normalizePluginRoutes', () => {
  it.each(['render', 'loader'] as const)('contains child %s failures and recovers on navigation', async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: RouteObject = failure === 'render'
      ? { path: '/broken', Component: CrashingPage }
      : { path: '/broken', loader: () => { throw new Error('route loader failed'); } };
    const router = createMemoryRouter(normalizePluginRoutes([{
      path: '/plugin',
      Component: PluginLayout,
      children: [broken, { path: '/healthy', element: <div>Healthy page</div> }],
    }], 'test-plugin'), { initialEntries: ['/plugin/broken'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(`route ${failure} failed`);
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    expect(screen.getByText('Plugin: test-plugin')).toBeInTheDocument();
    await act(async () => { await router.navigate('/plugin/healthy'); });
    expect(screen.getByText('Healthy page')).toBeInTheDocument();
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    router.dispose();
  });

  it('recovers after retrying a failed loader through same-route navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = true;
    const router = createMemoryRouter(normalizePluginRoutes([{
      path: '/plugin',
      Component: PluginLayout,
      children: [{
        path: 'retry',
        loader: () => {
          if (failing) throw new Error('temporary loader failure');
          return null;
        },
        element: <div>Recovered page</div>,
      }],
    }], 'test-plugin'), { initialEntries: ['/plugin/retry'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('temporary loader failure');
    failing = false;
    await act(async () => { await router.navigate('/plugin/retry'); });
    expect(await screen.findByText('Recovered page')).toBeInTheDocument();
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    router.dispose();
  });

  it('preserves explicit error boundaries and index normalization', () => {
    const Boundary = () => <div>Custom error</div>;
    const element = <div>Custom element</div>;
    const routes = normalizePluginRoutes([
      { path: '/component', ErrorBoundary: Boundary },
      { path: '/element', errorElement: element },
      { index: true, path: '/' },
    ], 'test-plugin');
    expect(routes[0].ErrorBoundary).toBe(Boundary);
    expect(routes[1].errorElement).toBe(element);
    expect(routes[2].path).toBeUndefined();
    expect(routes[2].ErrorBoundary).toBeDefined();
  });

  it('contains lazy page failures without replacing lazy plugin boundaries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const CustomBoundary = () => <div>Lazy custom error</div>;
    const router = createMemoryRouter(normalizePluginRoutes([{
      path: '/plugin',
      Component: PluginLayout,
      children: [
        { path: 'broken', lazy: async () => ({ Component: CrashingPage }) },
        { path: 'custom', lazy: async () => ({ Component: CrashingPage, ErrorBoundary: CustomBoundary }) },
        { path: 'object', lazy: { Component: async () => CrashingPage } },
        { path: 'object-custom', lazy: {
          Component: async () => CrashingPage,
          ErrorBoundary: async () => CustomBoundary,
        } },
      ],
    }], 'test-plugin'), { initialEntries: ['/plugin/broken'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('route render failed');
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    await act(async () => { await router.navigate('/plugin/custom'); });
    expect(await screen.findByText('Lazy custom error')).toBeInTheDocument();
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    await act(async () => { await router.navigate('/plugin/object'); });
    expect(await screen.findByRole('alert')).toHaveTextContent('route render failed');
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    await act(async () => { await router.navigate('/plugin/object-custom'); });
    expect(await screen.findByText('Lazy custom error')).toBeInTheDocument();
    expect(screen.getByText('Plugin navigation')).toBeInTheDocument();
    router.dispose();
  });
});
