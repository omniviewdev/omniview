import type { ColorRole } from './manifest.ts';

export type ThemeScheme = 'dark' | 'light';

/**
 * A built-in theme: the complete palette of one id.
 *
 * Schema 2. Schema 1 (the previous library's sparse override files that named a base theme) is not accepted: a theme
 * defines every role, so nothing falls through to another theme, and `Record<ColorRole, string>` makes a missing role a type error.
 */
export type ThemeDefinition = {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly name: string;
  readonly scheme: ThemeScheme;
  readonly colors: Readonly<Record<ColorRole, string>>;
};
