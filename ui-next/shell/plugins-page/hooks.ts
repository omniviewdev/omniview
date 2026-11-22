import { useSyncExternalStore } from 'react';
import type { ListState, PluginsModel, RowView } from './core/model';

// How the page's components read its model (`core/model.ts`): the list as one snapshot, and each row on its own, so that what happens to one plugin renders that plugin's row and nothing else of the list.

/** The list: its status, its plugins in order and the one the person is reading. The same object until one of them changes. */
export function useList(model: PluginsModel): ListState {
  return useSyncExternalStore(model.subscribe, model.getSnapshot);
}

/** One plugin's row, or undefined when the list has none by that id. The same object until what the row says changes, and a change of another plugin does not call this. */
export function useRow(model: PluginsModel, id: string): RowView | undefined {
  return useSyncExternalStore(
    (listener) => model.subscribeRow(id, listener),
    () => model.row(id),
  );
}
