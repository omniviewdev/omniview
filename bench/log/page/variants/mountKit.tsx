// Mounts K, the kit variant, in the stage. Loaded only by the kit branch of main.tsx: React, the React DOM client and the Profiler are imported here and nowhere on the
// control's path.
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import type { SyntheticFeed } from '../../../../packages/kit/src/components/LogView/syntheticFeed';
import type { Probe } from '../harness';
import Kit, { probe } from './Kit';

/** `profiled` wraps the kit in a Profiler that counts its commits into `window.__benchProfileCommits` (the cross-check of the DevTools hook's count). */
export function mountKit(stage: HTMLElement, feed: SyntheticFeed, profiled: boolean): { probe: Probe; unmount: () => void } {
  const root = createRoot(stage);
  root.render(
    profiled ? (
      <Profiler
        id="log"
        onRender={() => {
          window.__benchProfileCommits = (window.__benchProfileCommits ?? 0) + 1;
        }}
      >
        <Kit feed={feed} />
      </Profiler>
    ) : (
      <Kit feed={feed} />
    ),
  );
  return {
    probe,
    unmount: () => {
      root.unmount();
    },
  };
}
