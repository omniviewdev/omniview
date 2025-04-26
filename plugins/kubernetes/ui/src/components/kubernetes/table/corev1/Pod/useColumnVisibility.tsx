import React from "react"
import { ColumnDef, VisibilityState } from "@tanstack/react-table"

type Props = {
  pluginID?: string;
  resourceKey: string;
  columnDefs: Array<ColumnDef<any>>;
}

const fromColumnDefs = (defs: Array<ColumnDef<any>>): VisibilityState => {
  const visibility: VisibilityState = {}
  defs.forEach((def) => {
    let meta = def?.meta as { defaultHidden?: boolean } || undefined
    if (meta === undefined) {
      meta = {}
    }
    if (def.id && meta?.defaultHidden !== undefined) {
      visibility[def.id] = meta.defaultHidden
    }
  })
  return visibility
}

/**
 * Sets a specific column visibility from the local storage state
 * using saved defaults and the column def's default visibility.
 */
const useColumnVisibility = ({
  pluginID = 'kubernetes',
  resourceKey,
  columnDefs,
}: Props) => {
  const initialColumnVisibility = React.useMemo(() => fromColumnDefs(columnDefs), [columnDefs]);
  const state = React.useState<VisibilityState>(initialColumnVisibility)

  // we have to use layout effect to set the column visibility before the table is repainted, use effect will cause a flicker
  // also can't just put it in the initial state because it will cause an issue with table render as well
  React.useLayoutEffect(() => {
    // check local storage to see if they've saved this
    const storedColumnVisibility = window.localStorage.getItem(`${pluginID}-${resourceKey}-column-visibility`);
    if (storedColumnVisibility && initialColumnVisibility) {
      const current = JSON.parse(storedColumnVisibility);

      // make sure any new filters are added if they weren't there before
      Object.entries(initialColumnVisibility).forEach(([key, value]) => {
        if (!current.hasOwnProperty(key)) {
          current[key] = value;
        }
      });

      state[1](current);
    } else if (initialColumnVisibility) {
      state[1](initialColumnVisibility);
    }
  }, [initialColumnVisibility]);

  React.useEffect(() => {
    let visibility = JSON.stringify(state[0]);
    // save changes to local storage
    if (visibility !== '{}') {
      window.localStorage.setItem(`${pluginID}-${resourceKey}-column-visibility`, visibility);
    }
  }, [state[0]]);

  return state
}

export default useColumnVisibility
