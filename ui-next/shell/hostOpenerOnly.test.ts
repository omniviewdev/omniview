import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// The page opens an address outside the app through the host's opener (`AppService.OpenExternalURL`, which checks the scheme, the user information, the host's own servers and the
// length), never through the runtime's own `Browser.OpenURL`, whose validator lets `vscode:`, `ms-msdt:` and `smb:` through and knows nothing of the host's servers.

/** The lines of a source that call Wails' browser opener, as `Browser.OpenURL(...)` or through the v2-era name `BrowserOpenURL(...)`. A comment that names it is not a call. */
export function directOpenerCalls(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => /\bBrowser\s*\.\s*OpenURL\s*\(|\bBrowserOpenURL\s*\(/.test(line));
}

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCES = ['ui-next', 'ui', join('packages', 'omniviewdev-runtime', 'src'), join('packages', 'omniviewdev-providers', 'lib')];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'bindings', 'e2e', 'probes']);

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRECTORIES.has(name) ? [] : sourcesUnder(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('the page opens addresses through the host\'s opener', () => {
  it('finds a direct call of the runtime\'s browser opener, and not a comment that names it (the control of the scan)', () => {
    expect(directOpenerCalls("await Browser.OpenURL(url);")).toHaveLength(1);
    expect(directOpenerCalls("onClick={() => { void Browser.OpenURL(x); }}")).toHaveLength(1);
    expect(directOpenerCalls("export const BrowserOpenURL = (url) => BrowserOpenURL(url);")).toHaveLength(1);
    expect(directOpenerCalls(" * the host's own call (`Browser.OpenURL`), which opens it")).toHaveLength(0);
    expect(directOpenerCalls("// Browser.OpenURL(url) is what it was")).toHaveLength(0);
    expect(directOpenerCalls("await openExternalURL(url);")).toHaveLength(0);
  });

  it('has no page code that calls Browser.OpenURL', () => {
    const calls = SOURCES.flatMap((source) => sourcesUnder(join(ROOT, source))).flatMap((file) => directOpenerCalls(readFileSync(file, 'utf8')).map((line) => `${relative(ROOT, file).split(sep).join('/')}: ${line.trim()}`));
    expect(calls).toEqual([]);
  });
});
