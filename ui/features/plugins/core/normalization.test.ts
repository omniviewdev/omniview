import { describe, it, expect } from 'vitest';
import {
  normalizeContributions,
  normalizeExtensionRegistration,
  normalizeLegacySidebar,
  normalizeLegacyDrawer,
  RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
  RESOURCE_DRAWER_EXTENSION_POINT_ID,
} from './normalization';
import type { ValidatedExports, NormalizedContribution } from './types';
import { PluginWindow } from '@omniviewdev/runtime';

// Stubs
const SidebarA = () => null;
const SidebarB = () => null;
const DrawerFactoryA = () => ({ views: [] });

function makeValidated(overrides?: Partial<ValidatedExports>): ValidatedExports {
  return {
    plugin: new PluginWindow(),
    extensionRegistrations: [],
    sidebars: {},
    drawers: {},
    ...overrides,
  };
}

// ─── normalizeExtensionRegistration ──────────────────────────────────

describe('normalizeExtensionRegistration', () => {
  it('normalizes a generic registration', () => {
    const result = normalizeExtensionRegistration('pluginA', {
      extensionPointId: 'custom/ep',
      registration: { id: 'c1', label: 'Component 1', value: SidebarA, meta: { foo: 'bar' } },
    });
    expect(result.source).toBe('extension-registration');
    expect(result.pluginId).toBe('pluginA');
    expect(result.extensionPointId).toBe('custom/ep');
    expect(result.contributionId).toBe('pluginA/c1');
    expect(result.value).toBe(SidebarA);
    expect(result.label).toBe('Component 1');
    expect(result.meta).toEqual({ foo: 'bar' });
  });

  it('generates stable contribution ID', () => {
    const a = normalizeExtensionRegistration('X', {
      extensionPointId: 'ep',
      registration: { id: 'my-id', label: 'L', value: null },
    });
    const b = normalizeExtensionRegistration('X', {
      extensionPointId: 'ep',
      registration: { id: 'my-id', label: 'L', value: null },
    });
    expect(a.contributionId).toBe(b.contributionId);
    expect(a.contributionId).toBe('X/my-id');
  });
});

// ─── normalizeLegacySidebar ──────────────────────────────────────────

describe('normalizeLegacySidebar', () => {
  it('normalizes a legacy sidebar', () => {
    const result = normalizeLegacySidebar('pluginA', 'core::v1::Pod', SidebarA);
    expect(result.source).toBe('legacy-sidebar');
    expect(result.pluginId).toBe('pluginA');
    expect(result.extensionPointId).toBe(RESOURCE_SIDEBAR_EXTENSION_POINT_ID);
    expect(result.contributionId).toBe('pluginA/sidebar/core::v1::Pod');
    expect(result.value).toBe(SidebarA);
    expect(result.meta).toEqual({ pluginId: 'pluginA', resourceKey: 'core::v1::Pod' });
  });

  it('generates stable contribution ID', () => {
    const a = normalizeLegacySidebar('X', 'core::v1::Pod', SidebarA);
    const b = normalizeLegacySidebar('X', 'core::v1::Pod', SidebarA);
    expect(a.contributionId).toBe(b.contributionId);
  });
});

// ─── normalizeLegacyDrawer ───────────────────────────────────────────

describe('normalizeLegacyDrawer', () => {
  it('normalizes a legacy drawer', () => {
    const result = normalizeLegacyDrawer('pluginA', 'core::v1::Pod', DrawerFactoryA);
    expect(result.source).toBe('legacy-drawer');
    expect(result.pluginId).toBe('pluginA');
    expect(result.extensionPointId).toBe(RESOURCE_DRAWER_EXTENSION_POINT_ID);
    expect(result.contributionId).toBe('pluginA/drawer/core::v1::Pod');
    expect(result.value).toBe(DrawerFactoryA);
    expect(result.meta).toEqual({ pluginId: 'pluginA', resourceKey: 'core::v1::Pod' });
  });
});

// ─── normalizeContributions ──────────────────────────────────────────

describe('normalizeContributions', () => {
  it('normalizes extensionRegistrations only', () => {
    const validated = makeValidated({
      extensionRegistrations: [
        {
          extensionPointId: 'custom-ep',
          registration: { id: 'r1', label: 'R1', value: SidebarA },
        },
      ],
    });
    const result = normalizeContributions('pluginA', validated);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('extension-registration');
    expect(result[0].extensionPointId).toBe('custom-ep');
  });

  it('normalizes legacy sidebars only', () => {
    const validated = makeValidated({
      sidebars: {
        'core::v1::Pod': SidebarA,
        'apps::v1::Deployment': SidebarB,
      },
    });
    const result = normalizeContributions('pluginA', validated);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.source === 'legacy-sidebar')).toBe(true);
    expect(result.every((c) => c.extensionPointId === RESOURCE_SIDEBAR_EXTENSION_POINT_ID)).toBe(true);
  });

  it('normalizes legacy drawers only', () => {
    const validated = makeValidated({
      drawers: { 'core::v1::Pod': DrawerFactoryA },
    });
    const result = normalizeContributions('pluginA', validated);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('legacy-drawer');
    expect(result[0].extensionPointId).toBe(RESOURCE_DRAWER_EXTENSION_POINT_ID);
  });

  it('normalizes all sources together', () => {
    const validated = makeValidated({
      extensionRegistrations: [
        { extensionPointId: 'ep', registration: { id: 'r1', label: 'R1', value: 'v' } },
      ],
      sidebars: { 'core::v1::Pod': SidebarA },
      drawers: { 'core::v1::Pod': DrawerFactoryA },
    });
    const result = normalizeContributions('pluginA', validated);
    expect(result).toHaveLength(3);
    const sources = result.map((c) => c.source);
    expect(sources).toContain('extension-registration');
    expect(sources).toContain('legacy-sidebar');
    expect(sources).toContain('legacy-drawer');
  });

  it('empty validated exports produce empty contributions', () => {
    const result = normalizeContributions('pluginA', makeValidated());
    expect(result).toEqual([]);
  });

  it('contribution IDs are stable across calls', () => {
    const validated = makeValidated({
      sidebars: { 'core::v1::Pod': SidebarA },
    });
    const a = normalizeContributions('pluginA', validated);
    const b = normalizeContributions('pluginA', validated);
    expect(a[0].contributionId).toBe(b[0].contributionId);
  });

  it('sidebar contribution meta includes pluginId and resourceKey (Group 13.1 #4)', () => {
    const validated = makeValidated({
      sidebars: { 'core::v1::Pod': SidebarA },
    });
    const result = normalizeContributions('pluginA', validated);
    const meta = result[0].meta as { pluginId: string; resourceKey: string };
    expect(meta.pluginId).toBe('pluginA');
    expect(meta.resourceKey).toBe('core::v1::Pod');
  });

  it('multiple sidebars per plugin (Group 13.1 #5)', () => {
    const validated = makeValidated({
      sidebars: {
        'core::v1::Pod': SidebarA,
        'core::v1::Service': SidebarB,
        'apps::v1::Deployment': SidebarA,
        'apps::v1::StatefulSet': SidebarB,
        'batch::v1::Job': SidebarA,
      },
    });
    const result = normalizeContributions('pluginA', validated);
    expect(result).toHaveLength(5);
    expect(result.every((c) => c.source === 'legacy-sidebar')).toBe(true);
  });

  it('consumers cannot distinguish contribution source', () => {
    // All contributions have the same NormalizedContribution shape
    const validated = makeValidated({
      extensionRegistrations: [
        {
          extensionPointId: RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
          registration: { id: 'r1', label: 'R1', value: SidebarA, meta: { pluginId: 'A', resourceKey: 'core::v1::Pod' } },
        },
      ],
      sidebars: { 'apps::v1::Deployment': SidebarB },
    });
    const result = normalizeContributions('A', validated);
    // Both have the same fields — source is the only differentiator (and consumers don't use it)
    for (const c of result) {
      expect(c).toHaveProperty('pluginId');
      expect(c).toHaveProperty('extensionPointId');
      expect(c).toHaveProperty('contributionId');
      expect(c).toHaveProperty('value');
      expect(c).toHaveProperty('label');
    }
  });
});
