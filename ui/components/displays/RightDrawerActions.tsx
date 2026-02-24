import React, { useCallback, useMemo, useRef, useState } from 'react';

import { Tooltip } from '@omniviewdev/ui/overlays';
import { IconButton } from '@omniviewdev/ui/buttons';
import { DropdownMenu } from '@omniviewdev/ui/menus';
import Box from '@mui/material/Box';

import { DrawerComponentAction, DrawerContext, type DrawerComponentActionListItem } from '@omniviewdev/runtime';

type Props<T = any> = {
  ctx: DrawerContext;
  actions: Array<DrawerComponentAction<T>>
}

/**
 * Displays the menu of actions available for the drawer component
 */
const RightDrawerActions: React.FC<Props> = ({ ctx, actions }) => {
  if (!actions.length) {
    return <></>
  }

  return (
    <Box
      id={'actions-menu'}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 0,
      }}
    >
      {actions.map((action, i) => <RightDrawerAction key={i} ctx={ctx} action={action} />)}
    </Box>
  )
}

const RightDrawerAction: React.FC<{ ctx: DrawerContext; action: DrawerComponentAction }> = ({ ctx, action }) => {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkIsDisabled = () => {
    if (action.enabled === undefined) {
      return false
    }

    if (typeof action.enabled === 'function') {
      return !action.enabled((ctx))
    }
    return !action.enabled
  }

  const listItems = useMemo((): Array<DrawerComponentActionListItem> => {
    if (!action.list) return [];
    if (typeof action.list === 'function') {
      return action.list(ctx)
    }
    return action.list || []
  }, [action.list, ctx])

  const handleMouseEnter = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, 150);
  }, []);

  // Simple action button (no list)
  if (!!action.action && !action.list) {
    return (
      <Tooltip arrow content={action.title} emphasis='soft'>
        <span>
          <IconButton
            disabled={checkIsDisabled()}
            onClick={() => action.action?.(ctx)}
          >
            {action.icon}
          </IconButton>
        </span>
      </Tooltip>
    )
  }

  // List action with single item: click directly triggers the action
  if (!!action.list && listItems.length === 1) {
    return (
      <Tooltip arrow content={action.title} emphasis='soft'>
        <span>
          <IconButton
            disabled={checkIsDisabled()}
            onClick={() => listItems[0].action(ctx)}
          >
            {action.icon}
          </IconButton>
        </span>
      </Tooltip>
    )
  }

  // List action with multiple items: hover to show menu
  if (!!action.list && listItems.length > 1) {
    return (
      <span
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <DropdownMenu
          trigger={
            <Tooltip arrow content={action.title} emphasis='soft'>
              <span>
                <IconButton
                  disabled={checkIsDisabled()}
                >
                  {action.icon}
                </IconButton>
              </span>
            </Tooltip>
          }
          items={listItems.map((item, i) => ({
            key: String(i),
            label: item.title,
            icon: item.icon,
            onClick: () => {
              item.action(ctx);
              setOpen(false);
            },
          }))}
        />
      </span>
    )
  }

  return <></>
}


export default RightDrawerActions
