import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Group 24: Dead Code & Cleanup Verification
 *
 * Grep-based checks to confirm all superseded infrastructure is removed
 * and no dead imports remain.
 */

const UI_ROOT = path.resolve(__dirname, '../../..');
const PLUGINS_ROOT = path.resolve(__dirname, '..');

function readAllSourceFiles(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push({ file: full, content: fs.readFileSync(full, 'utf-8') });
      }
    }
  }

  walk(dir);
  return results;
}

describe('Group 24: Dead Code & Cleanup Verification', () => {
  const uiFiles = readAllSourceFiles(UI_ROOT);
  // Exclude test files and the deleted files themselves from checks
  const sourceFiles = uiFiles.filter(
    (f) => !f.file.includes('.test.') && !f.file.includes('.spec.'),
  );

  // 24.1 No imports of PluginManager.ts
  it('24.1 no imports of PluginManager.ts (the old file)', () => {
    // We only check for the OLD PluginManager.ts import path (features/plugins/PluginManager)
    // Not the usePluginManager hook at hooks/plugin/usePluginManager
    const matches = sourceFiles.filter(
      (f) => /from\s+['"].*features\/plugins\/PluginManager/.test(f.content),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.2 No imports of PluginRegistryProvider.tsx
  it('24.2 no imports of PluginRegistryProvider.tsx', () => {
    const matches = sourceFiles.filter(
      (f) => /from\s+['"].*PluginRegistryProvider/.test(f.content),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.3 No imports of usePluginRegistry.tsx
  it('24.3 no imports of usePluginRegistry.tsx', () => {
    const matches = sourceFiles.filter(
      (f) => /from\s+['"].*usePluginRegistry/.test(f.content),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.4 No imports of api/loader.ts
  it('24.4 no imports of api/loader.ts', () => {
    const matches = sourceFiles.filter(
      (f) => /from\s+['"].*api\/loader/.test(f.content),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.5 No imports of api/devSharedReady.ts
  it('24.5 no imports of api/devSharedReady.ts', () => {
    const matches = sourceFiles.filter(
      (f) => /from\s+['"].*devSharedReady/.test(f.content),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.6 No EventsEmit('plugin/install_complete')
  it('24.6 no EventsEmit plugin/install_complete', () => {
    const matches = sourceFiles.filter(
      (f) => f.content.includes("EventsEmit('plugin/install_complete')")
        || f.content.includes('EventsEmit("plugin/install_complete")'),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.7 No core/window/recalc_routes
  it('24.7 no core/window/recalc_routes references', () => {
    const matches = sourceFiles.filter(
      (f) => f.content.includes('core/window/recalc_routes'),
    );
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.8 No console.log in features/plugins/
  it('24.8 no console.log in features/plugins/ source files', () => {
    const pluginSourceFiles = readAllSourceFiles(PLUGINS_ROOT).filter(
      (f) => !f.file.includes('.test.') && !f.file.includes('.spec.'),
    );
    const matches = pluginSourceFiles.filter((f) => /console\.log\b/.test(f.content));
    expect(matches.map((f) => f.file)).toEqual([]);
  });

  // 24.9 No initDevSharedDeps in App.tsx
  it('24.9 no initDevSharedDeps in App.tsx', () => {
    const appFile = sourceFiles.find((f) => f.file.endsWith('/App.tsx'));
    expect(appFile).toBeDefined();
    expect(appFile!.content).not.toContain('initDevSharedDeps');
  });

  // 24.11 Deleted files don't exist
  it('24.11 deleted files no longer exist', () => {
    const deletedPaths = [
      'PluginManager.ts',
      'PluginRegistryProvider.tsx',
      '_PluginRegistryProvider.tsx',
      'PluginRegistryContext.ts',
      'usePluginRegistry.tsx',
      'api/loader.ts',
      'api/devSharedReady.ts',
      'api/builtins.ts',
      'api/constants.ts',
    ];

    for (const rel of deletedPaths) {
      const full = path.join(PLUGINS_ROOT, rel);
      expect(fs.existsSync(full), `Expected ${rel} to be deleted`).toBe(false);
    }
  });

});
