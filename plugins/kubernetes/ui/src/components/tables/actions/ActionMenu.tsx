import React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Popper from '@mui/material/Popper';
import { IconButton } from '@omniviewdev/ui/buttons';

// project imports
import ExecAction from './ExecAction';

// icons
import { MoreHorizRounded } from '@mui/icons-material';

// types
import { type Actions } from './types';
import DeleteAction from './DeleteAction';

type Props = {
  id: string;
  connection: string;
  resource: string;
  namespace: string;
  data: Record<string, unknown>;
  actions: Actions;
};

type ActionMenuListProps = Props & {
  dismissMenu: () => void;
};

const PopupBody = styled('div')(
  ({ theme }) => `
  width: max-content;
  border-radius: 8px;
  border: 1px solid ${theme.palette.divider};
  background-color: ${theme.palette.background.paper};
  box-shadow: ${theme.palette.mode === 'dark'
      ? '0px 4px 8px rgb(0 0 0 / 0.7)'
      : '0px 4px 8px rgb(0 0 0 / 0.1)'
    };
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 0.875rem;
  z-index: 1;
`,
);

const ActionMenu: React.FC<Props> = (props) => {
  const [selected, setSelected] = React.useState<HTMLElement | null>(null);

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    setSelected(selected ? null : event.currentTarget);
  }, [selected, setSelected]);

  const open = Boolean(selected);

  React.useEffect(() => {
    const handleScroll = () => {
      setSelected(null);
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  return (
    <>
      <IconButton
        size="sm"
        emphasis="ghost"
        sx={{
          flex: 'none',
          minHeight: 28,
          minWidth: 28,
        }}
        onClick={handleClick}
      >
        <MoreHorizRounded />
      </IconButton>
      <Popper
        style={{ zIndex: 9999 }}
        id={'resource-context-menu'}
        open={open}
        anchorEl={selected}
        placement={'bottom-end'}
      >
        <ClickAwayListener
          onClickAway={() => {
            setSelected(null);
          }}
        >
          <PopupBody>
            <ActionsMenuList {...props} dismissMenu={() => {
              setSelected(null);
            }} />
          </PopupBody>
        </ClickAwayListener>
      </Popper>
    </>
  );
};

const ActionsMenuList: React.FC<ActionMenuListProps> = ({
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
    <Box
      component='ul'
      sx={{
        listStyle: 'none',
        maxWidth: 400,
        minWidth: 110,
        borderRadius: 'sm',
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.body',
        paddingBlock: 0,
        paddingX: '2px',
        m: 0,
        p: 0,
        '--IconButton-size': '28px',
      }}
    >
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
        plugin={'kubernetes'}
        connection={connection}
        resource={resource}
        data={data}
      />}
      <DeleteAction
        plugin={'kubernetes'}
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
    </Box>
  );
};

ActionMenu.displayName = 'ActionMenu';
export default ActionMenu;
