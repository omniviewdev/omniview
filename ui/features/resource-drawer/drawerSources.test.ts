import { describe, expect, it } from 'vitest';
import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { DrawerFactory, SidebarComponent } from '@/features/plugins/core/types';
import { retiredDrawerSource } from './drawerSources';

const drawer = (plugin = 'A'): ExtensionContributionRegistration<DrawerFactory> => ({
  id: `${plugin}/drawer/widgets`, plugin, label: 'drawer', value: () => ({}), meta: { resourceKey: 'widgets' },
});
const sidebar = (plugin = 'A'): ExtensionContributionRegistration<SidebarComponent> => ({
  id: `${plugin}/sidebar/widgets`, plugin, label: 'sidebar', value: () => null, meta: { resourceKey: 'widgets' },
});

describe('retiredDrawerSource', () => {
  it('never retires a drawer that no contribution supplied', () => {
    expect(retiredDrawerSource({}, [], [])).toBeUndefined();
    expect(retiredDrawerSource({}, [drawer()], [sidebar()])).toBeUndefined();
  });

  it('keeps a drawer while the registry still holds every registration it was built from', () => {
    const d = drawer();
    const s = sidebar();
    expect(retiredDrawerSource({ drawer: d }, [d], [])).toBeUndefined();
    expect(retiredDrawerSource({ sidebar: s }, [], [s])).toBeUndefined();
    expect(retiredDrawerSource({ drawer: d, sidebar: s }, [d], [s])).toBeUndefined();
  });

  it('retires a drawer whose factory registration was removed', () => {
    const d = drawer('plugin-a');
    expect(retiredDrawerSource({ drawer: d }, [], [])).toBe(d);
  });

  it('retires a drawer whose sidebar registration was removed', () => {
    const s = sidebar('plugin-b');
    expect(retiredDrawerSource({ sidebar: s }, [], [])).toBe(s);
  });

  it('treats a replacement registration as a different contribution, even with the same ID', () => {
    const before = drawer();
    const after = drawer();
    expect(after.id).toBe(before.id);
    expect(retiredDrawerSource({ drawer: before }, [after], [])).toBe(before);
  });

  it('does not mistake a registration at the other extension point for its own', () => {
    const d = drawer();
    const s = sidebar();
    expect(retiredDrawerSource({ drawer: d }, [], [s])).toBe(d);
    expect(retiredDrawerSource({ drawer: d, sidebar: s }, [d], [])).toBe(s);
  });
});
