/**
 * Makes the kit's font files from the design mock's, and writes `fonts/manifest.json`, the record the tests and the notice check.
 *
 *   node scripts/subset-fonts.ts <the mock's assets/fonts directory>
 *
 * The directory is `app/OmniviewNativeLab/frontend/mock/assets/fonts` of the private repository omniviewdev/design-lab at tag
 * spec-baseline-2026-11-16 (commit 108d7049536e52d8d2f48c9a9b8d8cd94886fe81, mock tree c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0).
 * It needs `pyftsubset` and `python3` with fontTools, brotli and uharfbuzz (`pip install fonttools brotli uharfbuzz`); both programs are
 * looked up on PATH, or named by PYFTSUBSET and PYTHON. The bytes depend on those versions (fontTools closes the glyph set through
 * HarfBuzz when it is installed), so the manifest records them. Nothing in CI runs this: the outputs are committed, and
 * `scripts/fonts.test.ts` holds them to the manifest. Run it again only to change the character set or to take new source files, and
 * commit the result. It ends by shaping the same strings in the source and in each subset (`scripts/verify-subset-fonts.py`).
 *
 * What is made, and why it is this and not the whole file (each source is 259 to 274 KB, 90 to 120 KB as WOFF2):
 *   - one WOFF2 per face, holding the characters in RANGE: Latin text for the languages of Latin Extended-A, the punctuation and
 *     the arrows, operators and key symbols the mock's chrome draws. Every layout feature is kept (kerning, tabular numerals), so
 *     a covered string has the same widths as in the whole font. A character outside RANGE falls to the next family of the stack.
 *   - hinting stays and the name table stays whole, so the copyright and the licence travel inside each file.
 * The font is not renamed: the licence reserves no font name (the mock's copies name none).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../fonts');

/** The characters of the three files, as a CSS unicode-range (the stylesheet carries the same string). */
const RANGE = [
  'U+0020-007E', // Basic Latin
  'U+00A0-00FF', // Latin-1 Supplement
  'U+0100-017F', // Latin Extended-A
  'U+02C6', 'U+02DA', 'U+02DC', // modifier letters
  'U+2000-206F', // General Punctuation: the ellipsis, dashes, bullets, quotation marks, thin spaces
  'U+20AC', 'U+2122', // euro, trade mark
  'U+2190-2195', 'U+21B5', 'U+21C4', 'U+21E7', // arrows, return, swap, shift
  'U+2212', 'U+2215', 'U+221E', 'U+2248', 'U+2260', 'U+2264-2265', // minus, division slash, infinity, approx, not equal, less/greater or equal
  'U+22EF', 'U+2303', 'U+2318', 'U+2325', // midline ellipsis, control, command, option
  'U+25B2', 'U+25B6', 'U+25BC', 'U+25C0', // triangles
  'U+2605', 'U+2713', // star, check
  'U+FEFF', 'U+FFFD',
].join(', ');

type Source = { readonly directory: string; readonly file: string; readonly family: string; readonly weight: number; readonly output: string; readonly license: string; readonly licenseOutput: string };
const SOURCES: readonly Source[] = [
  { directory: 'inter', file: 'Inter-Regular.otf', family: 'Int UI Inter', weight: 400, output: 'Inter-Regular.latin.woff2', license: 'Inter_LICENSE.txt', licenseOutput: 'Inter-OFL.txt' },
  { directory: 'inter', file: 'Inter-SemiBold.otf', family: 'Int UI Inter', weight: 600, output: 'Inter-SemiBold.latin.woff2', license: 'Inter_LICENSE.txt', licenseOutput: 'Inter-OFL.txt' },
  { directory: 'mono', file: 'JetBrainsMono-Regular.ttf', family: 'Int UI Mono', weight: 400, output: 'JetBrainsMono-Regular.latin.woff2', license: 'OFL.txt', licenseOutput: 'JetBrainsMono-OFL.txt' },
];

const pyftsubset = process.env.PYFTSUBSET ?? 'pyftsubset';
const python = process.env.PYTHON ?? 'python3';
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const python3 = (code: string, ...args: string[]) => execFileSync(python, ['-c', code, ...args], { encoding: 'utf8' }).trim();
/** The versions of the three Python packages the bytes depend on. */
const versions = () => ({
  fonttools: python3('import fontTools; print(fontTools.version)'),
  brotli: python3('import brotli; print(brotli.__version__)'),
  uharfbuzz: python3('import uharfbuzz; print(uharfbuzz.__version__)'),
});

const sourceDirectory = process.argv[2];
if (sourceDirectory === undefined) {
  process.stderr.write('usage: node scripts/subset-fonts.ts <the mock\'s assets/fonts directory>\n');
  process.exit(2);
}

mkdirSync(out, { recursive: true });
const unicodes = RANGE.replaceAll(' ', '');
const faces = SOURCES.map((source) => {
  const input = path.join(sourceDirectory, source.directory, source.file);
  const output = path.join(out, source.output);
  execFileSync(pyftsubset, [input, `--unicodes=${unicodes}`, '--layout-features=*', '--name-IDs=*', '--notdef-outline', '--flavor=woff2', `--output-file=${output}`], { stdio: 'inherit' });
  copyFileSync(path.join(sourceDirectory, source.directory, source.license), path.join(out, source.licenseOutput));
  const version = python3('import sys; from fontTools.ttLib import TTFont; print(TTFont(sys.argv[1])["name"].getDebugName(5))', input);
  return {
    family: source.family,
    weight: source.weight,
    file: source.output,
    license: source.licenseOutput,
    sha256: sha256(output),
    bytes: statSync(output).size,
    unicodeRange: RANGE,
    source: { file: `app/OmniviewNativeLab/frontend/mock/assets/fonts/${source.directory}/${source.file}`, sha256: sha256(input), version },
  };
});

const manifest = {
  from: { repository: 'omniviewdev/design-lab', tag: 'spec-baseline-2026-11-16', commit: '108d7049536e52d8d2f48c9a9b8d8cd94886fe81', mockTree: 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0' },
  tool: { ...versions(), command: 'pyftsubset <source> --unicodes=<unicodeRange> --layout-features=* --name-IDs=* --notdef-outline --flavor=woff2' },
  faces,
};
writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${faces.map((face) => `${face.file}: ${face.bytes} B`).join('\n')}\n`);
// The design asks that a conversion keep shaping and metrics (research chapter 09, 3.1): compare every advance of the same strings.
execFileSync(python, [path.join(here, 'verify-subset-fonts.py'), sourceDirectory], { stdio: 'inherit' });
