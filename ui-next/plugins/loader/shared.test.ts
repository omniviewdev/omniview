import * as kit from '@omniviewdev/kit';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { SHARED_V1, registerShared, sharedId } from './shared';
import { SHARED_SPECIFIERS_V1 } from './specifiers';
import { systemJs } from './systemjs';

// The shared list is the ABI a plugin's bundle is built against. Here: the loaders serve exactly the names the list states, and what a plugin imports
// through SystemJS is the instance this module graph holds: the host's own React and kit, never a copy.

describe('the shared list', () => {
  it('has a loader for exactly the names it states, so a build and the host cannot disagree', () => {
    expect(Object.keys(SHARED_V1).sort()).toEqual([...SHARED_SPECIFIERS_V1].sort());
  });

  it('names no module of the old shell: the new shell does not carry the old libraries', () => {
    const old = SHARED_SPECIFIERS_V1.filter((name) => /base-ui|ai-ui|editors|react-router|react-dom|monaco|runtime\/(?:api|runtime|models)/.test(name));

    expect(old).toEqual([]);
  });

  it('shares the runtime as its curated entry and never as the whole barrel, which would bring the old UI library into the build', () => {
    expect(SHARED_SPECIFIERS_V1).toContain('@omniviewdev/runtime/ui/v1');
    expect(SHARED_SPECIFIERS_V1).not.toContain('@omniviewdev/runtime');
    expect(Object.keys(SHARED_V1)).not.toContain('@omniviewdev/runtime');
  });
});

describe('registered in SystemJS', () => {
  registerShared(systemJs);

  it('serves React as the instance the host holds', async () => {
    const served = await systemJs.import<typeof React>('react');

    expect(served.useState).toBe(React.useState);
    expect(served.createElement).toBe(React.createElement);
  });

  it('serves the kit as the instance the host holds', async () => {
    const served = await systemJs.import<typeof kit>('@omniviewdev/kit');

    expect(served.Text).toBe(kit.Text);
    expect(served.ThemeProvider).toBe(kit.ThemeProvider);
    expect(served.useTheme).toBe(kit.useTheme);
  });

  it('serves the runtime\'s curated entry as the instance the host holds, so a plugin\'s hook reads the host\'s query client and connection store', async () => {
    const served = await systemJs.import<typeof runtime>('@omniviewdev/runtime/ui/v1');

    expect(Object.keys(served).sort()).toEqual(Object.keys(runtime).sort());
    expect(served.useResources).toBe(runtime.useResources);
    expect(served.useConnections).toBe(runtime.useConnections);
    expect(served.useResource).toBe(runtime.useResource);
    expect(served.parseAppError).toBe(runtime.parseAppError);
  });

  it.each(SHARED_SPECIFIERS_V1)('serves %s', async (specifier) => {
    const served = await systemJs.import<Record<string, unknown>>(specifier);

    expect(Object.keys(served).length).toBeGreaterThan(0);
  });

  it('serves a development JSX runtime that has jsxDEV whatever the build made of the module', async () => {
    const served = await systemJs.import<{ jsxDEV: (type: string, props: Record<string, unknown>, key?: string) => { type: string; key: string | null } }>('react/jsx-dev-runtime');

    expect(typeof served.jsxDEV).toBe('function');
    expect(served.jsxDEV('div', {}, 'k')).toMatchObject({ type: 'div', key: 'k' });
  });

  it('is registered under URL-shaped ids, so no plugin can resolve one as a file of its own', () => {
    expect(sharedId('react')).toBe('shared://react');
    expect(systemJs.has(sharedId('react'))).toBe(true);
  });

  it('registers once per registry', () => {
    const before = [...systemJs.entries()].length;
    registerShared(systemJs);

    expect([...systemJs.entries()].length).toBe(before);
  });
});
