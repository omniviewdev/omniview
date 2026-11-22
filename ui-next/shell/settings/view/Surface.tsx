import { Sheet } from '@omniviewdev/kit';
import type { SurfaceProps } from '../host';
import { Body } from './Body';

/**
 * The Settings sheet: where there are no native windows (a browser: server mode, development) Settings is the kit's modal `Sheet` in the window, 1060 x 640 px as the original application's window, around the one `Body`. It is
 * mounted when it opens and goes with everything it started when it closes. Where there are native windows Settings is a window of its own (`window.tsx`) and this is not drawn.
 */
export function Surface({ session, page, onClose }: SurfaceProps) {
  return (
    <Sheet title="Settings" onClose={onClose} data-settings-part="sheet">
      <Body session={session} page={page} />
    </Sheet>
  );
}
