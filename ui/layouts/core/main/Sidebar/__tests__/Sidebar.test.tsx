import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import CoreLayoutSidebar from '..';

const plugin = (id: string) => ({ id, metadata: { icon: `https://example.com/${id}.png` } });

const mocks = vi.hoisted(() => ({
  plugins: [] as unknown[],
  registrations: new Map<string, { routes: unknown[] }>(),
}));

vi.mock('@/hooks/plugin/usePluginManager', () => ({
  usePluginManager: () => ({ plugins: { isLoading: false, data: mocks.plugins } }),
}));

vi.mock('@/features/plugins', () => ({
  usePluginService: () => ({ registrations: mocks.registrations }),
}));

const renderedPluginIds = () =>
  screen.getAllByRole('link').map((link) => link.getAttribute('href')?.replace('/_plugin/', ''));

describe('CoreLayoutSidebar', () => {
  it('hides loaded plugins that register no pages', () => {
    mocks.plugins = [plugin('kubernetes'), plugin('flux')];
    mocks.registrations = new Map([
      ['kubernetes', { routes: [{ path: '' }] }],
      ['flux', { routes: [] }],
    ]);

    render(<MemoryRouter><CoreLayoutSidebar /></MemoryRouter>);

    expect(renderedPluginIds()).toEqual(['kubernetes']);
  });

  it('keeps plugins that have not loaded yet', () => {
    mocks.plugins = [plugin('kubernetes'), plugin('aws')];
    mocks.registrations = new Map([['kubernetes', { routes: [{ path: '' }] }]]);

    render(<MemoryRouter><CoreLayoutSidebar /></MemoryRouter>);

    expect(renderedPluginIds()).toEqual(['kubernetes', 'aws']);
  });
});
