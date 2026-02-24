import React from 'react';

// material-ui
import { IconButton } from '@omniviewdev/ui/buttons';
import { List } from '@omniviewdev/ui';
import { Popover } from '@omniviewdev/ui/overlays';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { styled } from '@mui/material/styles';

// project imports
import ExecAction from './ExecAction';

// icons
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';

// types
import { type Actions } from './types';
import DeleteAction from './DeleteAction';

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

const PopupBody = styled('div')(
  ({ theme }) => `
  width: max-content;
  border-radius: 8px;
  border: 1px solid ${theme.palette.divider};
  background-color: ${theme.palette.background.popup};
  box-shadow: ${
  theme.palette.mode === 'dark'
    ? '0px 4px 8px rgb(0 0 0 / 0.7)'
    : '0px 4px 8px rgb(0 0 0 / 0.1)'
};
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 0.875rem;
  z-index: 1;
`,
);

const ActionMenu: React.FC<Props> = (props) => {
  // run our tooltip from the parent so we only render one of them
  // eslint-disable-next-line @typescript-eslint/ban-types
  const [selected, setSelected] = React.useState<HTMLElement | null>(null);

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    setSelected(selected ? null : event.currentTarget);
  }, [selected, setSelected]);

  const open = Boolean(selected);

  // dismiss the menu when the user scrolls
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
        <MoreHorizRoundedIcon />
      </IconButton>
      <Popover
        style={{ zIndex: 9999 }}
        id={'resource-context-menu'}
        open={open}
        anchor={selected}
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
            }}/>
          </PopupBody>
        </ClickAwayListener>
      </Popover>
    </>
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
    <List
      size='sm'
      emphasis="outline"
      sx={{
        maxWidth: 400,
        minWidth: 110,
        borderRadius: 'sm',
        backgroundColor: 'background.body',
        paddingBlock: 0,
        paddingX: '2px',
        '--IconButton-size': '28px',
        '--ListItem-paddingRight': '0px',
        '--ListItem-paddingLeft': '0px',
        '--ListItem-paddingY': '0px',
        '--ListItem-gap': '0px',
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
    </List>
  );
};

ActionMenu.displayName = 'ActionMenu';
export default ActionMenu;
