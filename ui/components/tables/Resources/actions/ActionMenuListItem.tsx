import React from 'react';

import { Menu } from '@omniviewdev/base-ui';

type ActionMenuListItemProps = {
  icon: React.ReactElement;
  /** The submenu contents (`Menu.Item` elements). */
  menu: React.ReactElement;
  /** Whether the submenu is open. */
  open: boolean;
  /** Called when the submenu requests to open. */
  onOpen: (
    event?:
    | React.MouseEvent<HTMLButtonElement>
    | React.KeyboardEvent<HTMLButtonElement>,
  ) => void;
  /**
   * Called when the submenu requests to close. The callback reports whether the
   * pointer is still on the trigger.
   */
  onLeaveMenu: (callback: () => boolean) => void;
  label: string;
} & React.HTMLAttributes<HTMLButtonElement>;

/**
 * A menu row that opens a submenu (to the left) on hover or keyboard navigation.
 * Must be rendered inside a `Menu.Popup`.
 */
function ActionMenuListItem({
  icon,
  children,
  menu,
  open,
  onOpen,
  onLeaveMenu,
  label,
}: Omit<ActionMenuListItemProps, 'color'>) {
  const isOnButton = React.useRef(false);

  return (
    <Menu.SubmenuRoot
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpen();
        } else {
          onLeaveMenu(() => isOnButton.current);
        }
      }}
    >
      <Menu.SubmenuTrigger
        startDecorator={icon}
        onMouseEnter={() => {
          isOnButton.current = true;
        }}
        onMouseLeave={() => {
          isOnButton.current = false;
        }}
      >
        {children}
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner side='left' align='start' sideOffset={4}>
          <Menu.Popup
            size='sm'
            id={`resource-action-submenu-${label}`}
            aria-label={label}
          >
            {menu}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

ActionMenuListItem.displayName = 'ActionMenuListItem';

export default ActionMenuListItem;
