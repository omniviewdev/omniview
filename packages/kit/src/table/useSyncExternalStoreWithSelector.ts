// Provenance: the `useSyncExternalStoreWithSelector` of React's use-sync-external-store package (shim/with-selector, MIT, Meta Platforms), written
// as an ES module over React's own `useSyncExternalStore`. TanStack Table 9 reaches it through @tanstack/react-store. The package ships it as
// CommonJS, and bundled into the kit that becomes a `require("react")` call that a browser does not have; React 19 has the hook built in, so
// the kit's build points the specifier here (vite.config.ts, `resolve.alias`) and the bundle holds only ES modules.
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/refs, react-hooks/immutability -- carried from React as it is: the hook keeps its own instance object in a ref and mutates it in an effect, and opts out of the compiler */
import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

type Instance<Selection> = { hasValue: boolean; value: Selection | null };

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | null | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  'use no memo';
  const instance = useRef<Instance<Selection> | null>(null);
  const inst: Instance<Selection> = instance.current ?? { hasValue: false, value: null };
  instance.current = inst;
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;
    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }

        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const currentSelection = memoizedSelection;
      if (Object.is(memoizedSnapshot, nextSnapshot)) {
        return currentSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual?.(currentSelection, nextSelection) === true) {
        memoizedSnapshot = nextSnapshot;
        return currentSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const serverSnapshot = getServerSnapshot ?? null;
    return [() => memoizedSelector(getSnapshot()), serverSnapshot === null ? undefined : () => memoizedSelector(serverSnapshot())] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual, inst]);
  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);
  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [inst, value]);
  useDebugValue(value);
  return value;
}
