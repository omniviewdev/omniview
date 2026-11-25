import type { MenuAction, MenuItem } from '@omniviewdev/kit';
import { ACTION_WORDS, availabilityOf, copyWordOf, type PortRow } from './model';
import { OPEN_ICON, STOP_ICON } from './tool';

// The row's context menu as data (docs/ui-next/status/kit-menus.md): the same three actions as the row's buttons, in the same order, with the same words and glyphs, each unavailable for the reason its button gives. Pure, so that its test can
// read it whole. The table gives the items to the window's menu host (`PortsTable.tsx`), which draws them, moves the focus and runs the action after the focus is back where the menu came from.

/** What a row's actions do: the store's, asked for by the row's id and the session the row shows (a press is for the session its button was drawn for). A menu does not know how any of it is done. */
export type PortsActions = {
  readonly stop: (id: string, session: number) => void;
  readonly open: (id: string, session: number) => void;
  readonly copy: (id: string, session: number) => void;
};

/**
 * Stop, Open in browser and Copy (Copy port, or Copy address when the producer states where the forward listens). Open in browser is not an item for a forward that is UDP, which a browser does not speak. No item draws a shortcut: none of the three has a chord, and the kit names an item by its label alone, so an item
 * that drew one would not be named by all that it draws (`terminal/menu/terminalMenu.ts` found this by probe).
 */
export function portsMenu(row: PortRow, actions: PortsActions): readonly MenuItem[] {
  const reach = availabilityOf(row);
  const stop: MenuAction = {
    kind: 'action',
    id: 'stop',
    label: ACTION_WORDS.stop,
    icon: STOP_ICON,
    disabled: reach.stop,
    onSelect: () => {
      actions.stop(row.id, row.session);
    },
  };
  const open: MenuAction = {
    kind: 'action',
    id: 'open',
    label: ACTION_WORDS.open,
    icon: OPEN_ICON,
    disabled: reach.open ?? undefined,
    onSelect: () => {
      actions.open(row.id, row.session);
    },
  };
  const copy: MenuAction = {
    kind: 'action',
    id: 'copy',
    label: copyWordOf(row),
    icon: 'copy',
    disabled: reach.copy,
    onSelect: () => {
      actions.copy(row.id, row.session);
    },
  };
  return reach.open === null ? [stop, copy] : [stop, open, copy];
}
