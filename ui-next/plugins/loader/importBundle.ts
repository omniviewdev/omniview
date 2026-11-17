import { BundleTimeoutError, IncompatibleBundleError } from './failure';
import { unservedImports } from './preflight';
import { registerShared } from './shared';
import { SHARED_SPECIFIERS_V1 } from './specifiers';
import { systemJs } from './systemjs';

// The one place a plugin's bundle is fetched and linked. Production: the Go host serves an installed plugin's files at `/_/plugins/<id>/assets/`
// (plugin_asset_handler.go: an allow-list, containment in the state root, `Cache-Control: no-store`); the new-UI bundle is the archive's one bundle,
// `assets/entry.js`, exactly where the old shell's is (docs/ui-next/slices/n19-plugin-seam.md, 1.2). Nothing here is specific to a plugin.

/** What the old shell allows an import (ui/features/plugins/core/types.ts: `importTimeoutMs`). */
export const IMPORT_TIMEOUT_MS = 30_000;

const origin = (): string => window.location.origin;
const root = (id: string): string => `${origin()}/_/plugins/${encodeURIComponent(id)}/`;

/** The URL of a plugin's bundle. */
export const entryUrl = (id: string): string => `${root(id)}assets/entry.js`;

type SystemHooks = {
  shouldFetch: (url: string) => boolean;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
};

let configured = false;

/**
 * Registers the shared names and routes every plugin file through `fetch`, where the host reads what a bundle imports before it evaluates it.
 * SystemJS loads a file with a script tag unless `shouldFetch` says to fetch it; fetched, it is evaluated only after this returns it.
 */
function configure(): void {
  if (configured) {
    return;
  }

  configured = true;
  registerShared(systemJs);
  const hooks = systemJs as unknown as SystemHooks;
  const plugins = `${origin()}/_/plugins/`;
  hooks.shouldFetch = (url) => url.startsWith(plugins);
  hooks.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      return response;
    }

    const unserved = unservedImports(await response.clone().text(), SHARED_SPECIFIERS_V1);
    if (unserved.length > 0) {
      throw new IncompatibleBundleError(unserved);
    }

    return response;
  };
}

/** A promise that rejects when the time is up, and the way to stop its clock. */
function deadline(milliseconds: number): { readonly expired: Promise<never>; readonly cancel: () => void } {
  let cancel = (): void => undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BundleTimeoutError(milliseconds));
    }, milliseconds);
    cancel = () => {
      clearTimeout(timer);
    };
  });
  return { expired, cancel };
}

async function within<Value>(work: Promise<Value>, milliseconds: number): Promise<Value> {
  const { expired, cancel } = deadline(milliseconds);
  try {
    return await Promise.race([work, expired]);
  } finally {
    cancel();
  }
}

/** Fetches, links and evaluates a plugin's bundle and answers its exports. Rejects with the loader's own errors or whatever the bundle threw. */
export async function importBundle(id: string, timeoutMs: number = IMPORT_TIMEOUT_MS): Promise<unknown> {
  configure();
  return within(systemJs.import(entryUrl(id)), timeoutMs);
}

/**
 * Drops every module of a plugin from the registry: its entry and each chunk. Chunk names are stable across versions, so a chunk that survived an
 * upgrade would be linked to the new entry's imports (docs/ui-next/optimisations.md HSH-11; the old shell does the same, adapters/clearPlugin.ts).
 */
export function clearBundle(id: string): void {
  const prefix = root(id);
  for (const [url] of [...systemJs.entries()]) {
    if (url.startsWith(prefix)) {
      systemJs.delete(url);
    }
  }
}
