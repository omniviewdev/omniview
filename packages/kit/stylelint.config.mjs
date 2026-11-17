// Closed scales for every stylesheet of the new trees: `packages/kit/src` and `ui-next`. Each allow-list is built from the token
// manifest, so a step added to a scale is allowed here by the same commit that generates its token. Built-in rules only.
import { FONT_SIZES, LINE_HEIGHTS, RADII, SPACING } from './tokens/manifest.ts';

const alternatives = (values) => values.join('|');
const spacing = `var\\(--ov-spacing-(?:${alternatives(SPACING)})\\)`;
const radius = `var\\(--ov-radius-(?:${alternatives(Object.keys(RADII))})\\)`;
// One to four values of a shorthand, each a step of the scale (or one of the extras).
const sides = (value) => `/^${value}(?: ${value}){0,3}$/`;
const colour = `(?:var\\(--ov-[a-z0-9-]+\\)|var\\(--_[a-z0-9-]+\\)|transparent|currentcolor|inherit|none)`;

const spacingProperties = (kind) =>
  `/^(?:${kind}(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|right|bottom|left))?)$/`;

export default {
  // A var() of a custom property that is declared nowhere is an error; the generated stylesheet is the reference.
  referenceFiles: ['src/generated/tokens.css'],
  rules: {
    'no-unknown-custom-properties': true,
    // A fallback would hide a misspelled token (the old library read 84 undefined names, most of them with a fallback).
    'declaration-property-value-disallowed-list': { '/.*/': ['/var\\(--ov-[^)]*,/'] },
    'declaration-no-important': true,
    'at-rule-disallowed-list': ['import'],
    // The kit and the host define no token of their own: a custom property declared here is private to its file and starts
    // with an underscore (--_name). Tokens are defined in the generated stylesheet only.
    'property-disallowed-list': [['backdrop-filter', 'text-shadow', '/^--(?!_)/'], { message: 'Declare only private custom properties here: --_name. Tokens are generated.' }],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix'],
    // The kit writes no rule for html, body or *; the host's reset is the one exception (see overrides).
    'selector-disallowed-list': [['/^\\*/', '/^(?:html|body)(?![\\w-])/'], { message: 'Style your own element. Document-level rules belong to the host entry.' }],
    'declaration-property-value-allowed-list': {
      // The font shorthand would set size, weight and line height outside the lists below, and reset font-feature-settings.
      font: ['inherit'],
      'font-size': [`/^var\\(--ov-fs-(?:${alternatives(FONT_SIZES)})\\)$/`, 'inherit'],
      'font-weight': ['400', '600', 'inherit'],
      'line-height': [`/^var\\(--ov-lh-(?:${alternatives(LINE_HEIGHTS)})\\)$/`, 'inherit'],
      'letter-spacing': ['normal'],
      'font-family': ['/^var\\(--ov-font-(?:ui|code)\\)$/', 'inherit'],
      '/^(?:gap|row-gap|column-gap)$/': [sides(`(?:${spacing}|0)`)],
      [spacingProperties('padding')]: [sides(`(?:${spacing}|0)`)],
      [spacingProperties('margin')]: [sides(`(?:${spacing}|0|auto)`)],
      '/^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/': [sides(`(?:${radius}|50%|0)`)],
      '/^(?:color|background-color|border-color|outline-color|fill|stroke|caret-color|accent-color)$/': [`/^${colour}$/`],
    },
  },
  overrides: [
    {
      // The generated stylesheet is where tokens, hex and colour functions are defined.
      files: ['src/generated/**/*.css'],
      rules: {
        'color-no-hex': null,
        'property-disallowed-list': null,
        'declaration-property-value-allowed-list': null,
        'no-unknown-custom-properties': null,
      },
    },
    {
      // The host entry's own document reset: the one place a rule for html, body or * is allowed, inside ov.reset.
      files: ['../../ui-next/global.css'],
      rules: { 'selector-disallowed-list': null },
    },
    {
      // The font faces are declared by their descriptors in one stylesheet: the two families the type tokens name, the two weights.
      files: ['src/styles/fonts.css'],
      rules: {
        'declaration-property-value-allowed-list': { 'font-family': ["/^'Int UI (?:Inter|Mono)'$/"], 'font-weight': ['400', '600'] },
      },
    },
  ],
};
