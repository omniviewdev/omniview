import { act, cleanup, render } from '@testing-library/react';
import {
  createThemeRegistry,
  type ThemeRegistry,
} from '@omniviewdev/base-ui';
import {
  ExtensionPointRegistry,
  ExtensionProvider,
  type ExtensionPointStoreContract,
} from '@omniviewdev/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeContributionBridge } from './ThemeContributionBridge';
import {
  THEME_EXTENSION_POINT_ID,
  createThemeExtensionPoint,
  type ThemeContribution,
} from './extensionPoint';

const slateTheme: ThemeContribution = {
  schemaVersion: 1,
  name: 'Slate',
  base: 'void',
  tokens: { 'color.bg.base': '#101114' },
};

let extensionRegistry: ExtensionPointRegistry;
let store: ExtensionPointStoreContract<ThemeContribution>;
let themeRegistry: ThemeRegistry;

function renderBridge() {
  return render(
    <ExtensionProvider registry={extensionRegistry}>
      <ThemeContributionBridge registry={themeRegistry} />
    </ExtensionProvider>,
  );
}

function registerTheme(
  id: string,
  plugin: string,
  value: ThemeContribution = slateTheme,
): void {
  store.register({ id, plugin, label: value.name, value });
}

describe('ThemeContributionBridge', () => {
  beforeEach(() => {
    extensionRegistry = new ExtensionPointRegistry();
    extensionRegistry.addExtensionPoint(createThemeExtensionPoint());
    store = extensionRegistry.getExtensionPoint<ThemeContribution>(
      THEME_EXTENSION_POINT_ID,
    )!;
    themeRegistry = createThemeRegistry();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('registers normalized plugin themes and removes them on plugin unload', () => {
    renderBridge();

    act(() => {
      registerTheme('acme/slate', 'acme');
    });

    expect(themeRegistry.has('plugin:acme/slate')).toBe(true);
    expect(themeRegistry.get('plugin:acme/slate')).toMatchObject({
      name: 'Slate',
      owner: { kind: 'plugin', id: 'acme' },
    });

    act(() => {
      store.removeContributionsByPlugin('acme');
    });

    expect(themeRegistry.has('plugin:acme/slate')).toBe(false);
  });

  it('strips only the exact normalized prefix and encodes every canonical ID segment', () => {
    renderBridge();

    act(() => {
      registerTheme('acme/acme/slate', 'acme', {
        ...slateTheme,
        name: 'Nested Slate',
      });
      registerTheme('palette/warm', 'team blue', {
        ...slateTheme,
        name: 'Warm',
      });
    });

    expect(themeRegistry.has('plugin:acme/acme%2Fslate')).toBe(true);
    expect(themeRegistry.has('plugin:team%20blue/palette%2Fwarm')).toBe(true);
  });

  it('replaces a contribution with the same plugin and normalized ID on reload', () => {
    renderBridge();

    act(() => {
      registerTheme('acme/slate', 'acme');
    });

    const original = themeRegistry.get('plugin:acme/slate');

    act(() => {
      store.removeContributionsByPlugin('acme');
      registerTheme('acme/slate', 'acme', {
        schemaVersion: 1,
        name: 'Slate Reloaded',
        base: 'dark',
        tokens: { 'color.bg.base': '#202126' },
      });
    });

    const replacement = themeRegistry.get('plugin:acme/slate');
    expect(replacement).not.toBe(original);
    expect(replacement).toMatchObject({
      name: 'Slate Reloaded',
      base: 'dark',
      owner: { kind: 'plugin', id: 'acme' },
      definition: {
        tokens: { 'color.bg.base': '#202126' },
      },
    });
  });

  it('disposes every bridged registration when the bridge unmounts', () => {
    const view = renderBridge();

    act(() => {
      registerTheme('acme/slate', 'acme');
      registerTheme('other/ember', 'other', {
        ...slateTheme,
        name: 'Ember',
      });
    });

    view.unmount();

    expect(themeRegistry.has('plugin:acme/slate')).toBe(false);
    expect(themeRegistry.has('plugin:other/ember')).toBe(false);
  });

  it('isolates invalid contributions without removing another plugin theme', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderBridge();

    act(() => {
      registerTheme('broken/invalid', 'broken', {
        schemaVersion: 1,
        name: 'Invalid',
        base: 'void',
        tokens: { 'not.a.theme.token': '#fff' },
      } as unknown as ThemeContribution);
      registerTheme('steady/slate', 'steady');
    });

    expect(themeRegistry.has('plugin:broken/invalid')).toBe(false);
    expect(themeRegistry.has('plugin:steady/slate')).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      '[ThemeContributionBridge] Invalid theme contribution',
      expect.objectContaining({
        pluginId: 'broken',
        contributionId: 'broken/invalid',
        themeId: 'plugin:broken/invalid',
        code: 'unknown_token',
        path: 'tokens.not.a.theme.token',
      }),
    );

    act(() => {
      store.removeContributionsByPlugin('broken');
    });

    expect(themeRegistry.has('plugin:steady/slate')).toBe(true);
  });
});
