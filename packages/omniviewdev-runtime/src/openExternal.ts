import { OpenExternalURL } from './bindings/github.com/omniviewdev/omniview/appservice';

/** The host refused an address: `reason` is its typed answer (`scheme`, `userinfo`, `own-server`, `malformed` or `too-long`). The message holds nothing of the address. */
export class ExternalURLRefusedError extends Error {
  constructor(readonly reason: string) {
    super('The host does not open this address.');
    this.name = 'ExternalURLRefusedError';
  }
}

/**
 * Opens an address in the system's browser through the host: `AppService.OpenExternalURL`, which checks it (http and https, no user information, not one of the
 * host's own servers, at most 2,083 bytes) and starts the browser without a shell. Resolves when the host opened it.
 */
export async function openExternalURL(address: string): Promise<void> {
  const answer = await OpenExternalURL(address);
  if (!answer.opened) {
    throw new ExternalURLRefusedError(String(answer.reason ?? ''));
  }
}
