// The fixture's failing page command (O1b-1): Restart on the item's detail page. A real plugin's command is an `async` handler that calls the host, and the host answers a failure with its `apperror` envelope, which
// the runtime's hooks throw as a `RuntimeError`: an error whose `message` is the envelope's JSON and whose `cause` is the object. The fixture does the same on demand, so that what the host makes of a failed page
// command is seen on the real page, over the real host (the seam check) and in the browser (the notices probe). It is QUIET unless a check asks: `window.__fixtureDetail` does not exist until a check makes it,
// and without a `failure` Restart does nothing, as it always did.

/** How Restart fails: with the host's TIMEOUT, with its FORBIDDEN, with an error that is not the host's envelope (whose text must never reach the screen), or by being cancelled. */
export type FailureName = 'timeout' | 'forbidden' | 'generic' | 'cancelled';

type Control = {
  readonly failure?: FailureName | undefined;
  /** What Restart was asked, in order: for the check to read. */
  readonly runs: Array<{ readonly item: string }>;
};

const isControl = (value: unknown): value is Control => typeof value === 'object' && value !== null && 'runs' in value && Array.isArray(value.runs);

const controlOf = (): Control | undefined => {
  const found: unknown = Reflect.get(window, '__fixtureDetail');
  return isControl(found) ? found : undefined;
};

/** The envelope as the host sends it (`apperror.AppError`; one request id, no recovery). */
const envelope = (code: string, type: string, title: string, status: number, detail: string): Readonly<Record<string, unknown>> => ({ type, title, status, detail, code, requestId: '5b8c2f6e-7a43-4e0a-9d1f-0c7a1d2e3f40', recovery: 'none' });

/** What Wails gives the page: the envelope as the message of an error, and the object as its cause. */
const wails = (body: Readonly<Record<string, unknown>>): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

function failureOf(name: FailureName): Error {
  switch (name) {
    case 'timeout':
      return wails(envelope('TIMEOUT', 'omniview:resource/timeout', 'Timed out', 408, 'The cluster did not complete the request in time.'));
    case 'forbidden':
      return wails(envelope('FORBIDDEN', 'omniview:resource/forbidden', 'Access denied', 403, 'The operation is not permitted.'));
    case 'generic':
      return new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    case 'cancelled':
      return new DOMException('The operation was aborted.', 'AbortError');
  }
}

/** The Restart of the item's page: nothing, unless a check made `window.__fixtureDetail` say how it fails. It answers later, as a command that calls the host does. */
export async function restartItem(item: string): Promise<void> {
  const control = controlOf();
  if (control?.failure === undefined) {
    return;
  }

  control.runs.push({ item });
  await Promise.resolve();
  throw failureOf(control.failure);
}
