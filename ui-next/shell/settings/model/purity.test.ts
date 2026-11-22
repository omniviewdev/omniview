import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Settings model (the adapter, the session) is plain TypeScript over the `SettingsClient` seam: no React, no DOM, no host binding, no timer of its own. A model that imports a framework or the runtime cannot be run in a
// plain test, and could not be given a host that answers from memory, which is how the sheet's probes run it.

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));

const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the settings model\'s sources', () => {
  it('import nothing but their siblings and the field model', () => {
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const { name, text } of sources) {
      const foreign = imports(text).filter((specifier) => !specifier.startsWith('./') && specifier !== '../../core/fields' && specifier !== '../../core/fields/testing');
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it('touch no browser global and no timer: the form model has its own, on the scheduler it is given', () => {
    const globals = /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|setTimeout|clearTimeout|setInterval|queueMicrotask|performance|Date\.now|console)\b(?!\s*:)/;
    for (const { name, text } of sources) {
      const code = withoutComments(text).replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'');
      expect({ name, found: globals.exec(code)?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('keep test support out of the model', () => {
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, usesTesting: imports(text).some((specifier) => specifier.includes('testing')) }).toEqual({ name, usesTesting: false });
    }
  });
});
