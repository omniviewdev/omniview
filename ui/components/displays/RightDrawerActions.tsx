import React from 'react';

import {
  ButtonGroup,
  Dropdown,
  Tooltip,
  IconButton,
  MenuItem,
  MenuButton,
  Menu,
  ListItemDecorator,
} from '@mui/joy';

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
    <ButtonGroup
      id={'actions-menu'}
      size='sm'
      sx={{
        '--ButtonGroup-separatorSize': '0px',
      }}
    >
      {actions.map((action) => <RightDrawerAction ctx={ctx} action={action} />)}
    </ButtonGroup>
  )
}

const RightDrawerAction: React.FC<{ ctx: DrawerContext; action: DrawerComponentAction }> = ({ ctx, action }) => {
  console.log("got action", { ctx, action })

  const checkIsDisabled = () => {
    if (action.enabled === undefined) {
      return false
    }

    if (typeof action.enabled === 'function') {
      return !action.enabled((ctx))
    }
    return !action.enabled
  }

  const getList = (): Array<DrawerComponentActionListItem> => {
    if (typeof action.list === 'function') {
      return action.list(ctx)
    }

    return action.list || []
  }


  if (!!action.action) {
    return (
      <Tooltip arrow title={action.title} variant='soft'>
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

  if (!!action.list) {
    return (
      <span>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            disabled={checkIsDisabled()}
          >
            {action.icon}
          </MenuButton>
          <Menu size='sm'>
            {getList().map((item) => (
              <MenuItem
                sx={{ px: 1, minWidth: '100px' }}
                onClick={() => item.action(ctx)}
              >
                {item.icon && <ListItemDecorator>
                  {item.icon}
                </ListItemDecorator>
                }
                {item.title}
              </MenuItem>
            ))}
          </Menu>
        </Dropdown>
      </span>
    )
  }

  return <></>
}


export default RightDrawerActions
