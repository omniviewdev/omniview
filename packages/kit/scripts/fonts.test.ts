import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { FONTS } from '../tokens/manifest.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = async (relative: string) => readFile(path.join(root, relative), 'utf8');
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

type Face = {
  readonly family: string;
  readonly weight: number;
  readonly file: string;
  readonly license: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly unicodeRange: string;
  readonly source: { readonly file: string; readonly sha256: string; readonly version: string };
};
type FontManifest = { readonly faces: readonly Face[] };

const manifest = JSON.parse(await read('fonts/manifest.json')) as FontManifest;

/** The families the token stack names first: `'Int UI Inter', -apple-system, …` and `'Int UI Mono', monospace`. */
const families = [FONTS.ui, FONTS.code].map((stack) => /^'([^']+)'/.exec(stack)?.[1]);

describe('the font files', () => {
  it('are the three faces the mock uses: Inter 400 and 600, JetBrains Mono 400, under the token families', () => {
    expect(manifest.faces.map((face) => `${face.family} ${face.weight}`)).toEqual(['Int UI Inter 400', 'Int UI Inter 600', 'Int UI Mono 400']);
    for (const face of manifest.faces) {
      expect(families, face.family).toContain(face.family);
    }

    expect(manifest.faces.reduce((total, face) => total + face.bytes, 0)).toBeLessThan(110_000);
  });

  it.each(manifest.faces.map((face) => [`${face.family} ${face.weight}`, face] as const))('%s is a WOFF2 file that is what the manifest says', async (_name, face) => {
    const data = await readFile(path.join(root, 'fonts', face.file));
    expect(data.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(data.length).toBe(face.bytes);
    expect(sha256(data)).toBe(face.sha256);
    // A UI face is a subset: each source file is 90 to 120 KB as WOFF2 whole (259 to 274 KB as shipped by the mock), and the three
    // together stay under 110 KB.
    expect(face.bytes).toBeLessThan(45_000);
    expect(face.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(face.source.version).not.toBe('');
  });
});

describe('the font stylesheet', () => {
  const faces = async () => {
    const rules: Array<Record<string, string>> = [];
    postcss.parse(await read('src/styles/fonts.css')).walkAtRules('font-face', (rule) => {
      const declarations: Record<string, string> = {};
      rule.walkDecls((declaration) => {
        declarations[declaration.prop] = declaration.value;
      });
      rules.push(declarations);
    });
    return rules;
  };

  it('declares one @font-face for each face of the manifest, with the manifest weight and range', async () => {
    const rules = await faces();
    expect(rules).toHaveLength(manifest.faces.length);
    for (const [index, face] of manifest.faces.entries()) {
      const rule = rules[index];
      expect(rule?.['font-family']).toBe(`'${face.family}'`);
      expect(rule?.['font-weight']).toBe(String(face.weight));
      expect(rule?.['font-style']).toBe('normal');
      expect(rule?.['unicode-range']).toBe(face.unicodeRange);
      expect(rule?.src).toBe(`url('../../fonts/${face.file}') format('woff2')`);
    }
  });

  it('swaps: text never waits for a font, and a face that is late changes nothing after the first paint of a preloaded one', async () => {
    for (const rule of await faces()) {
      expect(rule['font-display']).toBe('swap');
    }
  });

  it('is imported by the bundle entry after the layer order statement, so that statement stays the first rule', async () => {
    const entry = await read('src/entry.ts');
    const layers = entry.indexOf('import \'./styles/layers.css\'');
    const fonts = entry.indexOf('import \'./styles/fonts.css\'');
    expect(layers).toBeGreaterThanOrEqual(0);
    expect(fonts).toBeGreaterThan(layers);
  });

  it('is what the type tokens name: contextual alternates stay off for every text', () => {
    expect(FONTS.features).toBe('\'calt\' 0');
  });
});

describe('NOTICE', () => {
  it('carries the licence of each font file verbatim, with its copyright line', async () => {
    const notice = await read('NOTICE');
    const licences = [...new Set(manifest.faces.map((face) => face.license))];
    expect(licences.sort()).toEqual(['Inter-OFL.txt', 'JetBrainsMono-OFL.txt']);
    for (const licence of licences) {
      const text = (await read(path.join('fonts', licence))).trim();
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(notice, licence).toContain(text);
    }

    expect(notice).toContain('Copyright (c) 2016-2020 The Inter Project Authors');
    expect(notice).toContain('Copyright 2020 The JetBrains Mono Project Authors');
    // The package ships NOTICE (package.json "files"): the licence travels with every copy of a font.
    // A type for a file of this repository, read as JSON: there is nothing to validate at run time.
    const packageJson = JSON.parse(await read('package.json')) as { files: string[] };
    expect(packageJson.files).toContain('NOTICE');
  });

  it('names the changes: subset, WOFF2, source files and where they come from', async () => {
    const notice = await read('NOTICE');
    expect(notice).toMatch(/subset/i);
    expect(notice).toContain('WOFF2');
    for (const face of manifest.faces) {
      expect(notice, face.source.file).toContain(face.source.file);
      expect(notice, face.source.sha256).toContain(face.source.sha256);
    }
  });

  it('keeps the licence files beside the fonts and in the manifest', async () => {
    for (const face of manifest.faces) {
      await expect(stat(path.join(root, 'fonts', face.license))).resolves.toBeDefined();
    }
  });
});
