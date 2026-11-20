import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The model is pure TypeScript: no React, no DOM, no other tree. A model that imports a framework cannot be run in a worker, in a plain test, or by another UI.

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));

const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** What the model may take from its neighbours in `core`: the tab model's plain data helpers and its JSON type. Nothing from the tree above. */
const NEIGHBOURS = ['../tabs/json', '../tabs/types'];

describe('the model\'s sources', () => {
  it('import nothing but their own siblings and the plain helpers of core', () => {
    expect(sources.length).toBeGreaterThan(8);
    for (const { name, text } of sources) {
      const foreign = imports(text).filter((specifier) => !specifier.startsWith('./') && !NEIGHBOURS.includes(specifier));
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it('touch no browser global: no document, window, navigator, storage or animation frame', () => {
    const globals = /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement)\b(?!\s*:)/;
    for (const { name, text } of sources) {
      const code = withoutComments(text).replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'');
      expect({ name, found: globals.exec(code)?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('read no timer but the scheduler they are given, and the platform\'s only as its default (the store)', () => {
    for (const { name, text } of sources.filter((source) => !['store.ts', 'testing.ts', 'types.ts'].includes(source.name))) {
      expect({ name, found: /(?<![.\w])(?:setTimeout|clearTimeout|setInterval|performance|Date\.now)\b/.exec(withoutComments(text))?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('log nothing but the store\'s default error hook: a secret must not reach a console by another way', () => {
    for (const { name, text } of sources.filter((source) => !['store.ts', 'testing.ts'].includes(source.name))) {
      expect({ name, found: /\bconsole\./.exec(withoutComments(text))?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('keep test support out of the model', () => {
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, usesTesting: imports(text).some((specifier) => specifier.includes('testing')) }).toEqual({ name, usesTesting: false });
    }
  });
});
