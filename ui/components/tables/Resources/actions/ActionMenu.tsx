import React from 'react';

import { IconButton, Menu } from '@omniviewdev/base-ui';

// project imports
import ExecAction from './ExecAction';

// icons
import { LuEllipsis } from 'react-icons/lu';

// types
import { type Actions } from './types';
import DeleteAction from './DeleteAction';
import styles from './ActionMenu.module.css';

type Props = {
  plugin: string;
  connection: string;
  resource: string;
  namespace: string;
  id: string;
  data: Record<string, unknown>;
  actions: Actions;
};

type ActionMenuListProps = Props & {
  dismissMenu: () => void;
};

const ActionMenu: React.FC<Props> = (props) => {
  const [open, setOpen] = React.useState(false);
  // Once opened, keep the popup mounted so a confirmation dialog launched from one of
  // its items survives the menu closing. Rows that were never opened render no popup.
  const [everOpened, setEverOpened] = React.useState(false);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setEverOpened(true);
    }
  }, []);

  // dismiss the menu when the user scrolls
  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleScroll = () => {
      setOpen(false);
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  return (
    <Menu.Root open={open} onOpenChange={handleOpenChange}>
      <Menu.Trigger
        render={
          <IconButton
            size="sm"
            variant="ghost"
            color="neutral"
            aria-label="Resource actions"
            className={styles.Trigger}
          >
            <LuEllipsis />
          </IconButton>
        }
      />
      <Menu.Portal keepMounted={everOpened}>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className={styles.Positioner}>
          <Menu.Popup id={'resource-context-menu'} size="sm" className={styles.Popup}>
            <ActionsMenuList {...props} dismissMenu={() => {
              setOpen(false);
            }}/>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

const ActionsMenuList: React.FC<ActionMenuListProps> = ({
  plugin,
  connection,
  resource,
  data,
  actions,
  id,
  namespace,
  dismissMenu,
}) => {
  const [menuSelected, setMenuSelected] = React.useState<undefined | string>(undefined);

  const itemProps = {
    onClick: () => {
      setMenuSelected(undefined);
    },
  };

  const createHandleLeaveMenu =
    (id: string) => (getIsOnButton: () => boolean) => {
      setTimeout(() => {
        const isOnButton = getIsOnButton();
        if (!isOnButton) {
          setMenuSelected((latestId: undefined | string) => {
            if (id === latestId) {
              return undefined;
            }

            return latestId;
          });
        }
      }, 200);
    };

  return (
    <>
      {actions.exec && <ExecAction
        selected={menuSelected === 'exec'}
        handleSelect={() => {
          setMenuSelected('exec');
        }}
        handleDeselect={() => {
          setMenuSelected(undefined);
        }}
        handleLeaveMenu={createHandleLeaveMenu('exec')}
        handleDismiss={dismissMenu}
        itemProps={itemProps}
        action={actions.exec}
        plugin={plugin}
        connection={connection}
        resource={resource}
        data={data}
      />}
      <DeleteAction
        plugin={plugin}
        connection={connection}
        resource={resource}
        namespace={namespace}
        id={id}
        handleSelect={() => {
          setMenuSelected('delete');
        }}
        handleDeselect={() => {
          setMenuSelected(undefined);
        }}
        handleDismiss={dismissMenu}
      />
    </>
  );
};

ActionMenu.displayName = 'ActionMenu';
export default ActionMenu;
