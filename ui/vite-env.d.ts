import 'vite/client';
import type { BootIdentity } from './features/instance/boot';

declare global {
  interface Window {
    __OMNIVIEW_INSTANCE__?: unknown;
    __OMNIVIEW_BOOTSTRAP__?: Readonly<{
      identity: BootIdentity | null;
      storageKey: (key: string) => string | null;
    }>;
  }
}
