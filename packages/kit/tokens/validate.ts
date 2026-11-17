/*
 * Adapted from omniviewdev/ui `packages/base-ui/src/theme/validation.ts` at 65bbefb (the error class, the code vocabulary
 * and the id and metadata checks). Re-valued for schema 2: a definition is complete, and every colour is an sRGB hex literal,
 * so there is no `CSS.supports` probe, no named-colour table and no structural colour parser to carry over.
 */
import { COLOR_ROLES } from './manifest.ts';
import type { ThemeDefinition, ThemeScheme } from './schema.ts';

export type ThemeValidationErrorCode =
  | 'unsupported_schema'
  | 'invalid_id'
  | 'invalid_metadata'
  | 'unknown_token'
  | 'missing_token'
  | 'invalid_value'
  | 'duplicate_id'
  | 'missing_default';

export class ThemeValidationError extends Error {
  readonly code: ThemeValidationErrorCode;
  readonly path: string;

  constructor(code: ThemeValidationErrorCode, path: string, message: string) {
    super(message);
    this.name = 'ThemeValidationError';
    this.code = code;
    this.path = path;
  }
}

const ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const HEX_COLOR = /^#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const SCHEMES: readonly ThemeScheme[] = ['dark', 'light'];
const ROLE_SET: ReadonlySet<string> = new Set(COLOR_ROLES);

function fail(code: ThemeValidationErrorCode, path: string, message: string): never {
  throw new ThemeValidationError(code, path, message);
}

/** Validate one theme definition and return a frozen copy. Throws `ThemeValidationError` with a stable code and the offending path. */
export function validateThemeDefinition(input: unknown): ThemeDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('invalid_metadata', '', 'Theme definition must be an object');
  }

  const candidate = input as Record<string, unknown>;

  if (candidate.schemaVersion !== 2) {
    fail('unsupported_schema', 'schemaVersion', 'Only theme schema version 2 is supported');
  }

  const id = candidate.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    fail('invalid_id', 'id', 'Theme id must be lowercase letters, digits and hyphens, starting with a letter');
  }

  const name = candidate.name;
  if (typeof name !== 'string' || name.length === 0 || name.length > 80) {
    fail('invalid_metadata', 'name', 'Theme name must contain 1 to 80 characters');
  }

  const scheme = candidate.scheme;
  if (typeof scheme !== 'string' || !SCHEMES.includes(scheme as ThemeScheme)) {
    fail('invalid_metadata', 'scheme', 'Theme scheme must be "dark" or "light"');
  }

  const colors = candidate.colors;
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors)) {
    fail('invalid_metadata', 'colors', 'Theme colors must be an object');
  }

  const entries = Object.entries(colors as Record<string, unknown>);
  for (const [role] of entries) {
    if (!ROLE_SET.has(role)) {
      fail('unknown_token', `colors.${role}`, `Unknown colour role: ${role}`);
    }
  }

  const copy: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    const value = (colors as Record<string, unknown>)[role];
    if (value === undefined) {
      fail('missing_token', `colors.${role}`, `Theme "${id}" does not define ${role}`);
    }

    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      fail('invalid_value', `colors.${role}`, `${role} must be a #RRGGBB or #RRGGBBAA hex colour`);
    }

    copy[role] = value;
  }

  return Object.freeze({
    schemaVersion: 2,
    id,
    name,
    scheme: scheme as ThemeScheme,
    colors: Object.freeze(copy),
  });
}

/** Validate the whole set: every definition, unique ids, and a default that exists. */
export function validateThemeDefinitions(definitions: readonly unknown[], defaultId: string): readonly ThemeDefinition[] {
  const seen = new Set<string>();
  const valid = definitions.map((definition, index) => {
    try {
      return validateThemeDefinition(definition);
    } catch (error) {
      if (error instanceof ThemeValidationError) {
        throw new ThemeValidationError(error.code, `themes[${index}].${error.path}`, error.message);
      }

      throw error;
    }
  });
  for (const [index, definition] of valid.entries()) {
    if (seen.has(definition.id)) {
      fail('duplicate_id', `themes[${index}].id`, `Duplicate theme id: ${definition.id}`);
    }

    seen.add(definition.id);
  }

  if (!seen.has(defaultId)) {
    fail('missing_default', 'themes', `The default theme "${defaultId}" is not defined`);
  }

  return valid;
}
