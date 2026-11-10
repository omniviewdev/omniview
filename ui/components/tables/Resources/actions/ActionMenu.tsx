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
import type { HostRecord } from '@omniviewdev/runtime';
import type { ResourceTableRow } from '@/hooks/resource/useResourceDefinition';

type Props = {
  plugin: string;
  connection: string;
  resource: string;
  record: HostRecord;
  data: Record<string, unknown>;
  actions: Actions;
};

type ActionMenuListProps = Props & {
  dismissMenu: () => void;
};

/** Resource actions read the body as a plain object. Rows with any other body have no action menu. */
export const isActionableBody = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const RowMenuHandle = React.createContext<React.ComponentProps<typeof Menu.Trigger>['handle']>(undefined);

type ActionMenuScopeProps = {
  /** The actions every row offers. Absent until the provider's action handlers are known. */
  actions?: Actions;
  plugin: string;
  connection: string;
  resource: string;
  children: React.ReactNode;
};

/**
 * One menu owns the popup for every row trigger of a table. Rows mount a button that carries its
 * row as the payload, so scrolling mounts no per-row menu state and the menu always acts on the
 * row that opened it.
 */
export const ActionMenuScope: React.FC<ActionMenuScopeProps> = ({ actions, plugin, connection, resource, children }) => {
  const [handle] = React.useState(() => Menu.createHandle<unknown>());
  const [open, setOpen] = React.useState(false);

  // dismiss the menu when the user scrolls
  React.useEffect(() => {
    if (!open) {
      return;
    }

    const handleScroll = () => {
      handle.close();
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, handle]);

  return (
    <RowMenuHandle.Provider value={handle}>
      {children}
      <Menu.Root handle={handle} onOpenChange={setOpen}>
        {({ payload }) => {
          const row = payload as ResourceTableRow | undefined;
          if (actions === undefined || row === undefined || !isActionableBody(row.data)) {
            return null;
          }

          // Once opened, keep the popup mounted so a confirmation dialog launched from one of
          // its items survives the menu closing. The row key resets the items for the next row.
          return (
            <Menu.Portal keepMounted>
              <Menu.Positioner side="bottom" align="end" sideOffset={4} className={styles.Positioner}>
                <Menu.Popup id={'resource-context-menu'} size="sm" className={styles.Popup}>
                  <ActionsMenuList
                    key={row.record.key}
                    plugin={plugin}
                    connection={connection}
                    resource={resource}
                    record={row.record}
                    data={row.data}
                    actions={actions}
                    dismissMenu={() => {
                      handle.close();
                    }}
                  />
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          );
        }}
      </Menu.Root>
    </RowMenuHandle.Provider>
  );
};

/** The button that opens the table's action menu for one row. Render it inside an `ActionMenuScope`. */
export const ActionMenuTrigger: React.FC<{ row: ResourceTableRow }> = ({ row }) => {
  const handle = React.useContext(RowMenuHandle);
  if (handle === undefined) {
    throw new Error('Resource row actions require ActionMenuScope.');
  }

  return (
    <Menu.Trigger
      handle={handle}
      payload={row}
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
  );
};

const ActionsMenuList: React.FC<ActionMenuListProps> = ({
  plugin,
  connection,
  resource,
  data,
  actions,
  record,
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
        record={record}
      />}
      <DeleteAction
        plugin={plugin}
        route={record.route}
        reference={record.record.reference}
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

ActionMenuScope.displayName = 'ActionMenuScope';
ActionMenuTrigger.displayName = 'ActionMenuTrigger';
