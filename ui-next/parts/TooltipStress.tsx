import { Button, IconButton, tip } from '@omniviewdev/kit';
import { useLayoutEffect, useState } from 'react';

declare global {
  // Global augmentation: only an interface can merge into `Window`.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    __stress?: { readonly renderMs: number };
  }
}

/**
 * The tooltip's stress page (`?screen=tooltip-stress&n=1000&mode=tip`, docs/ui-next/status/1a.4d.md): N cheap triggers in one list, with a tip
 * each (`mode=tip`) or none (`mode=plain`, the control), a dialog stand-in whose Close button has a tip, and four triggers in the corners
 * of the window. `packages/kit/probes/tooltip-probe.mjs` reads it: the listeners the page registers, the time to render the list, how long a
 * tip takes to open, and the Escape that must reach the dialog behind a tip.
 */
export function TooltipStress({ count, withTips }: { readonly count: number; readonly withTips: boolean }) {
  const [renderStart] = useState(() => performance.now());
  const [closed, setClosed] = useState(false);

  useLayoutEffect(() => {
    window.__stress = { renderMs: performance.now() - renderStart };
  }, [renderStart]);

  return (
    <div
      role="dialog"
      aria-label="Probe dialog"
      data-closed={closed ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setClosed(true);
        }
      }}
    >
      <IconButton icon="close" label="Close" data-testid="close" data-ov-tip="Close" onClick={() => {
        setClosed(true);
      }} />
      <Button data-testid="first" data-ov-tip="Create a Row">Create</Button>
      <ul data-testid="list">
        {Array.from({ length: count }, (_, index) => (
          <li key={index}>
            <span data-testid={`row-${index}`} {...(withTips ? tip(`Row ${index} was created 4 days ago`) : {})}>
              item-{index}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
