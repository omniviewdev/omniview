import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { leaveHandle } from './focus';
import { usePanel } from './context';
import { createSplitter, type Splitter } from './splitter';

/**
 * The splitter of the panel's top edge: the controller (`./splitter.ts`) for as long as the panel is mounted, and the one hand-back it needs React for: once the committed size is drawn, the
 * inline size the drag wrote is removed and the stylesheet's rule (`--_size`, else the default) is the size again. It runs in a layout effect, in the commit that draws the new size, so the
 * panel never shows the old size between the two.
 */
export function useSplitter(panel: RefObject<HTMLElement | null>, height: number | null, open: boolean): Splitter {
  const { store } = usePanel();
  const [splitter] = useState(() => createSplitter({ store, panel: () => panel.current, onCollapse: leaveHandle }));

  useLayoutEffect(() => {
    splitter.release();
  }, [splitter, height, open]);

  useEffect(
    () => () => {
      splitter.dispose();
    },
    [splitter],
  );

  return splitter;
}
