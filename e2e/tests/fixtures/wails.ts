import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page, Route } from '@playwright/test';

// Generated Wails bindings for the app's own Go packages. Each exported function
// calls `$Call.ByID(<methodID>, ...args)`; the ID is a hash that changes whenever
// the Go method moves, so it is read from the generated file instead of being
// hard-coded here.
const BINDINGS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview',
);

/** Wails services the tests talk to, as paths under the bindings root. */
export const Service = {
  exec: 'backend/pkg/plugin/exec/servicewrapper.ts',
  plugins: 'backend/pkg/plugin/servicewrapper.ts',
  settings: 'internal/settings/servicewrapper.ts',
} as const;

type ServiceFile = (typeof Service)[keyof typeof Service];

const idCache = new Map<string, number>();

export function methodId(service: ServiceFile, method: string): number {
  const key = `${service}#${method}`;
  const cached = idCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const source = readFileSync(resolve(BINDINGS_ROOT, service), 'utf8');
  const match = new RegExp(`export function ${method}\\([\\s\\S]*?\\$Call\\.ByID\\((\\d+)`).exec(source);
  if (!match) {
    throw new Error(`no binding ${method} in ${service}`);
  }

  const id = Number(match[1]);
  idCache.set(key, id);
  return id;
}

type RuntimeCall = {
  object: number;
  method: number;
  args?: { methodID?: number; args?: unknown[] };
};

/**
 * Calls a Go binding over the server-mode runtime endpoint, the same way the
 * frontend does. Used to set up and tear down backend state around a test.
 */
export async function callBinding<T = unknown>(
  request: APIRequestContext,
  service: ServiceFile,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const response = await request.post('/wails/runtime', {
    headers: { 'x-wails-client-id': 'e2e' },
    data: { object: 0, method: 0, args: { 'call-id': `e2e-${Date.now()}`, methodID: methodId(service, method), args } },
  });
  if (!response.ok()) {
    throw new Error(`${method} failed: ${response.status()} ${await response.text()}`);
  }

  // Strings come back as plain text, everything else as JSON.
  const text = await response.text();
  const isJson = response.headers()['content-type']?.includes('application/json');
  return (isJson && text ? JSON.parse(text) : text || undefined) as T;
}

/** Return this from a mocked binding to make the call fail in the page. */
export class BindingError {
  readonly message: string;

  constructor(message: string) {
    this.message = message;
  }
}

/**
 * Answers the given binding calls from the page with canned results instead of
 * the backend. Every other runtime call goes through untouched.
 */
export async function mockBindings(
  page: Page,
  service: ServiceFile,
  results: Record<string, unknown | ((args: unknown[]) => unknown)>,
): Promise<void> {
  const byId = new Map(Object.entries(results).map(([method, result]) => [methodId(service, method), result]));

  await page.route('**/wails/runtime', async (route: Route) => {
    let call: RuntimeCall | undefined;
    try {
      call = route.request().postDataJSON() as RuntimeCall;
    } catch {
      // chunked or non-JSON bodies are never ours
    }

    const id = call?.args?.methodID;
    if (id === undefined || !byId.has(id)) {
      await route.fallback();
      return;
    }

    const result = byId.get(id);
    const body = typeof result === 'function' ? result(call?.args?.args ?? []) : result;
    if (body instanceof BindingError) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'RuntimeError', message: body.message }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? null) });
  });
}
