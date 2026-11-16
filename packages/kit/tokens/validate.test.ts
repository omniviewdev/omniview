import { describe, expect, it } from 'vitest';
import { COLOR_ROLES } from './manifest.ts';
import { DEFAULT_THEME_ID, THEME_DEFINITIONS } from './themes.ts';
import { ThemeValidationError, validateThemeDefinition, validateThemeDefinitions } from './validate.ts';

const void_ = THEME_DEFINITIONS.find((theme) => theme.id === DEFAULT_THEME_ID)!;

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ThemeValidationError) {
      return `${error.code} ${error.path}`;
    }

    throw error;
  }

  return undefined;
}

describe('the built-in themes', () => {
  it('are nine valid, complete palettes with unique ids and the default among them', () => {
    expect(validateThemeDefinitions(THEME_DEFINITIONS, DEFAULT_THEME_ID)).toHaveLength(9);
    expect(THEME_DEFINITIONS.map((theme) => theme.id)).toEqual([
      'void',
      'dark',
      'light',
      'obsidian',
      'carbon',
      'solarized-dark',
      'solarized-light',
      'high-contrast-dark',
      'high-contrast-light',
    ]);
  });

  it('define every colour role, and nothing else', () => {
    expect(COLOR_ROLES).toHaveLength(78);
    for (const theme of THEME_DEFINITIONS) {
      expect(Object.keys(theme.colors).sort(), theme.id).toEqual([...COLOR_ROLES].sort());
    }
  });

  it('keep the mock values of the default theme', () => {
    expect(void_.scheme).toBe('dark');
    expect(void_.colors['bg-window']).toBe('#26282C');
    expect(void_.colors['bg-island']).toBe('#191A1C');
    expect(void_.colors.fg).toBe('#D1D3D9');
    expect(void_.colors.accent).toBe('#3871E1');
    expect(void_.colors['hover-row']).toBe('#FFFFFF10');
  });
});

describe('validateThemeDefinition rejects', () => {
  it('another schema version', () => {
    expect(codeOf(() => validateThemeDefinition({ ...void_, schemaVersion: 1 }))).toBe('unsupported_schema schemaVersion');
  });

  it('an id that is not lowercase kebab case', () => {
    expect(codeOf(() => validateThemeDefinition({ ...void_, id: 'Void' }))).toBe('invalid_id id');
    expect(codeOf(() => validateThemeDefinition({ ...void_, id: 'has space' }))).toBe('invalid_id id');
  });

  it('a missing name or an unknown scheme', () => {
    expect(codeOf(() => validateThemeDefinition({ ...void_, name: '' }))).toBe('invalid_metadata name');
    expect(codeOf(() => validateThemeDefinition({ ...void_, scheme: 'sepia' }))).toBe('invalid_metadata scheme');
  });

  it('a role the theme does not define', () => {
    const { ['bg-island']: removed, ...rest } = void_.colors;
    expect(removed).toBeDefined();
    expect(codeOf(() => validateThemeDefinition({ ...void_, colors: rest }))).toBe('missing_token colors.bg-island');
  });

  it('a role the vocabulary does not have, such as a misspelled one', () => {
    expect(codeOf(() => validateThemeDefinition({ ...void_, colors: { ...void_.colors, 'bg-islnad': '#000000' } }))).toBe(
      'unknown_token colors.bg-islnad',
    );
  });

  it('a value that is not an sRGB hex literal', () => {
    for (const value of ['red', 'rgb(0 0 0)', '#FFF', '#12345', 'var(--x)', 'color-mix(in srgb, red, blue)', 12]) {
      expect(codeOf(() => validateThemeDefinition({ ...void_, colors: { ...void_.colors, fg: value } })), String(value)).toBe(
        'invalid_value colors.fg',
      );
    }
  });
});

describe('validateThemeDefinitions rejects', () => {
  it('a duplicate id, reporting the index', () => {
    expect(codeOf(() => validateThemeDefinitions([void_, void_], DEFAULT_THEME_ID))).toBe('duplicate_id themes[1].id');
  });

  it('a set without its default theme', () => {
    expect(codeOf(() => validateThemeDefinitions([void_], 'nope'))).toBe('missing_default themes');
  });

  it('an invalid member, reporting its index', () => {
    expect(codeOf(() => validateThemeDefinitions([void_, { ...void_, id: 'x', scheme: '' }], DEFAULT_THEME_ID))).toBe(
      'invalid_metadata themes[1].scheme',
    );
  });
});
