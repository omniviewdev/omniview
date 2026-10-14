/**
 * Plugins import `@omniviewdev/runtime/runtime` through SystemJS, where a name
 * the host no longer exports is just `undefined`. Native ESM rejects that, so
 * plugin code gets this superset (older kubernetes plugin commits still import
 * the Wails v2-era `BrowserOpenURL`).
 */
import { Browser } from '../../../packages/omniviewdev-runtime/src/runtime';

export * from '../../../packages/omniviewdev-runtime/src/runtime';
export const BrowserOpenURL = (url: string) => Browser.OpenURL(url);
