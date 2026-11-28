import path from 'node:path';

export const SDK = '@omniviewdev/runtime/ui/extensions/v1';
export type Data = string | number | boolean | Data[] | DataObject;
export type DataObject = { [key: string]: Data };
export type Locator = { package: string; version: string; export: string };
export type LiteralExport = { file: string; name: string; value: Data };
export type Role = { source: 'features.ts' | 'views.tsx'; asset: 'extensions.js' | 'views.js'; names: string[] };
export type Watch = (file: string) => void;

export function fail(message: string): never {
  throw new Error(`Omniview extensions v1: ${message}`);
}

export function object(value: Data | undefined, field: string): DataObject {
  if (typeof value !== 'object' || Array.isArray(value) || value === null) {
    fail(`${field}: expected a literal record`);
  }

  return value;
}

export function list(value: Data | undefined, field: string): Data[] {
  if (!Array.isArray(value)) {
    fail(`${field}: expected a literal tuple`);
  }

  return value;
}

export function text(value: Data | undefined, field: string): string {
  if (typeof value !== 'string') {
    fail(`${field}: expected a string literal`);
  }

  return value;
}

export function closed(record: DataObject, field: string, keys: readonly string[]): void {
  if (Object.keys(record).some(key => !keys.includes(key))) {
    fail(`${field}: unexpected member`);
  }
}

export function equal(a: Data, b: Data): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal((a as DataObject)[k], (b as DataObject)[k]));
}

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
