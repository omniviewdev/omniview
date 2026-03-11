/**
 * Group 23 — Consumer Migration Verification Tests (B11)
 *
 * These tests read source files and assert the presence/absence of imports and
 * patterns to verify that consumers have been migrated away from the legacy
 * plugin-loading helpers toward the new PluginService-based API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = '/Users/joshuapare/Repos/omniviewdev/omniview-plugin-sdk-rewrite';

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// 23.1 — usePluginManager Hook
// ---------------------------------------------------------------------------
describe('23.1 usePluginManager hook (ui/hooks/plugin/usePluginManager.ts)', () => {
  const rel = 'ui/hooks/plugin/usePluginManager.ts';
  const getSource = () => readSource(rel);

  it('1. No EventsEmit(\'plugin/install_complete\') calls', () => {
    const source = getSource();
    expect(source).not.toContain("EventsEmit('plugin/install_complete')");
    expect(source).not.toContain('EventsEmit("plugin/install_complete")');
  });

  it('2. No loadAndRegisterPlugin import', () => {
    const source = getSource();
    expect(source).not.toContain('loadAndRegisterPlugin');
  });

  it('3. No clearPlugin direct import from old loader', () => {
    const source = getSource();
    expect(source).not.toContain('clearPlugin');
  });

  it('4. Uses usePluginService() hook (imports from barrel)', () => {
    const source = getSource();
    expect(source).toContain('usePluginService');
  });

  it('5. Install onSuccess calls service load (not loadAndRegisterPlugin)', () => {
    const source = getSource();
    expect(source).not.toContain('loadAndRegisterPlugin');
    expect(source).toMatch(/void\s+load\(|\.load\(/);
  });

  it('6. Uninstall onSuccess calls service unload (not clearPlugin)', () => {
    const source = getSource();
    expect(source).not.toContain('clearPlugin');
    expect(source).toMatch(/serviceUnload\(|void\s+serviceUnload\(|\.unload\(/);
  });

  it('7. Update onSuccess calls service reload (not loadAndRegisterPlugin)', () => {
    const source = getSource();
    expect(source).not.toContain('loadAndRegisterPlugin');
    expect(source).toMatch(/serviceReload\(|void\s+serviceReload\(|\.reload\(/);
  });
});

// ---------------------------------------------------------------------------
// 23.2 — PluginsNav
// ---------------------------------------------------------------------------
describe('23.2 PluginsNav (ui/pages/plugins/PluginsNav.tsx)', () => {
  const rel = 'ui/pages/plugins/PluginsNav.tsx';
  const getSource = () => readSource(rel);

  it('8. No EventsEmit import or call', () => {
    const source = getSource();
    expect(source).not.toContain('EventsEmit');
  });

  it('9. No loadAndRegisterPlugin import', () => {
    const source = getSource();
    expect(source).not.toContain('loadAndRegisterPlugin');
  });

  it('10. Uses usePluginService from barrel', () => {
    const source = getSource();
    expect(source).toContain('usePluginService');
  });
});

// ---------------------------------------------------------------------------
// 23.3 — PluginRenderer
// ---------------------------------------------------------------------------
describe('23.3 PluginRenderer (ui/features/plugins/components/PluginRenderer.tsx)', () => {
  const rel = 'ui/features/plugins/components/PluginRenderer.tsx';
  const getSource = () => readSource(rel);

  it('11. Uses loadedAt as React key (key={loadedAt} present)', () => {
    const source = getSource();
    // Accept JSX key expressions like key={loadedAt} or key={`${loadedAt}`}
    expect(source).toMatch(/key=\{.*loadedAt.*\}/);
  });

  it('12. No manual dev_reload_complete listener (no EventsOn for dev_reload)', () => {
    const source = getSource();
    expect(source).not.toContain('dev_reload_complete');
    expect(source).not.toContain('EventsOn');
  });

  it('13. No import from old loader (no clearPlugin, no loadAndRegisterPlugin)', () => {
    const source = getSource();
    expect(source).not.toContain('clearPlugin');
    expect(source).not.toContain('loadAndRegisterPlugin');
  });

  it('14. Uses usePluginService from barrel', () => {
    const source = getSource();
    expect(source).toContain('usePluginService');
  });
});

// ---------------------------------------------------------------------------
// 23.4 — PluginLoadErrorPage
// ---------------------------------------------------------------------------
describe('23.4 PluginLoadErrorPage (ui/features/plugins/components/PluginLoadErrorPage.tsx)', () => {
  const rel = 'ui/features/plugins/components/PluginLoadErrorPage.tsx';
  const getSource = () => readSource(rel);

  it('15. Uses usePluginService from barrel (not old usePluginRegistry)', () => {
    const source = getSource();
    expect(source).toContain('usePluginService');
    expect(source).not.toContain('usePluginRegistry');
  });

  it('16. Has retry action (calls retry)', () => {
    const source = getSource();
    expect(source).toMatch(/retry/i);
  });

  it('17. Has reset/forceReset action', () => {
    const source = getSource();
    expect(source).toMatch(/reset|forceReset/i);
  });

  it('18. References validationErrors', () => {
    const source = getSource();
    expect(source).toContain('validationErrors');
  });
});

// ---------------------------------------------------------------------------
// 23.5 — AppStatusFooter
// ---------------------------------------------------------------------------
describe('23.5 AppStatusFooter (ui/components/displays/Footer/AppStatusFooter.tsx)', () => {
  const rel = 'ui/components/displays/Footer/AppStatusFooter.tsx';
  const getSource = () => readSource(rel);

  it('19. No import of usePluginRegistry', () => {
    const source = getSource();
    expect(source).not.toContain('usePluginRegistry');
  });

  it('20. Uses usePluginService from barrel', () => {
    const source = getSource();
    expect(source).toContain('usePluginService');
  });

  it('21. Derives failed plugins from plugins.values() and phase === \'error\'', () => {
    const source = getSource();
    // Expect iteration over plugin values and a check for error phase
    expect(source).toMatch(/plugins\.values\(\)|\.values\(\)/);
    expect(source).toMatch(/phase\s*===?\s*['"]error['"]/);
  });
});
