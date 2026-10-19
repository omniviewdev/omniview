import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Explicit feature directories, never a filesystem wildcard or guessed sibling. */
export function workspaceViteRoots(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const roots: unknown = JSON.parse(raw);
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('OMNIVIEW_VITE_ALLOWED_ROOTS must be a nonempty JSON array');
  }

  return [...new Set(roots.map((root: unknown) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)
      || root.includes('*') || root.includes('\0') || path.parse(root).root === root) {
      throw new Error('Vite workspace roots must be explicit absolute repository directories');
    }

    const canonical = realpathSync(root);
    if (canonical !== path.resolve(root) || !statSync(canonical).isDirectory()) {
      throw new Error('Vite workspace roots must be canonical repository directories');
    }

    return canonical;
  }))];
}

export function workspaceVitePort(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!/^[0-9]+$/.test(raw)) {
    throw new Error('Owned Vite port must be an integer');
  }

  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error('Owned Vite port is outside 1..65535');
  }

  return port;
}

export function workspaceViteCacheDirectory(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!path.isAbsolute(raw) || raw.includes('\0') || path.parse(raw).root === raw) {
    throw new Error('Managed Vite cache must be an explicit absolute directory');
  }

  const canonical = realpathSync(raw);
  if (canonical !== path.resolve(raw) || !statSync(canonical).isDirectory()) {
    throw new Error('Managed Vite cache must be an existing canonical owned directory');
  }

  return canonical;
}
