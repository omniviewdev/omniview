import { createRowMenu, IconButton, RovingGroup, RowMenu, tip, type RowMenuItem } from '@omniviewdev/kit';
import { useState } from 'react';
import { fitTools, LOG_TOOLS_LABEL, menuLabelOf, MORE_LABEL, MORE_MENU_LABEL, tipOf, type LogTool, type LogToolId } from './toolbar';

type LogToolbarProps = {
  /** The buttons, in the order they stand (`logToolsOf`). */
  readonly tools: readonly LogTool[];
  /** How many buttons the column holds (`slotsFor` of its height). More buttons than that put the last ones behind the More button. Absent: every button is drawn. */
  readonly slots?: number | undefined;
  /** A button was pressed. A button that cannot apply is never reported: the kit's button does nothing for it, and the menu skips its item. */
  readonly onPress: (tool: LogToolId) => void;
};

/**
 * The Logs tool's vertical toolbar (the mock's `.panel__tools`, shell-regions.js 314-320): `role="toolbar" aria-orientation="vertical"` with its name, 28 px ghost icon buttons 4 px apart, one Tab stop with the arrows
 * of a column, Home and End. A toggle keeps its one name and says its state in `aria-pressed`; a button that cannot apply stays focusable and says why (its description and the second line of its tooltip).
 *
 * A column that does not hold every button keeps the first ones and puts the rest behind a `⋯` More actions button that takes the last slot (the mock's `toolbarOf`, shell-regions.js 303-308: the last hide first,
 * none is clipped and the column never scrolls). The menu is the kit's row menu (the one the page header's overflow uses), a sibling of the toolbar so that its items are not stops of it; the trigger is the toolbar's
 * last button and takes none of its arrows (the menu opens on Enter and Space, a click and a press of the pointer).
 */
export function LogToolbar({ tools, slots = Number.POSITIVE_INFINITY, onPress }: LogToolbarProps) {
  const [menu] = useState(() => createRowMenu<undefined>());
  const { shown, rest } = fitTools(tools, slots);
  const items = rest.map(
    (tool): RowMenuItem<undefined> => ({
      id: tool.id,
      label: menuLabelOf(tool),
      disabled: tool.disabledReason !== undefined,
      onSelect: () => {
        onPress(tool.id);
      },
    }),
  );

  return (
    <>
      <RovingGroup label={LOG_TOOLS_LABEL} kind="column" role="toolbar" gap={4} align="center">
        {shown.map((tool) => (
          <IconButton
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            variant="ghost"
            pressed={tool.pressed}
            disabledReason={tool.disabledReason}
            data-log-tool={tool.id}
            {...tip(tipOf(tool))}
            onClick={() => {
              onPress(tool.id);
            }}
          />
        ))}
        {rest.length === 0 ? null : (
          <IconButton
            icon="ellipsis"
            label={MORE_LABEL}
            variant="ghost"
            popup="menu"
            data-log-tool="more"
            {...tip(MORE_LABEL)}
            onClick={(event) => {
              // A click with no pointer behind it is a key (Enter, Space): the first item takes the focus (the page header's overflow does the same).
              menu.toggle(event.currentTarget, undefined, event.detail === 0 ? 'first' : 'menu');
            }}
          />
        )}
      </RovingGroup>
      <RowMenu handle={menu} label={MORE_MENU_LABEL} items={() => items} />
    </>
  );
}
