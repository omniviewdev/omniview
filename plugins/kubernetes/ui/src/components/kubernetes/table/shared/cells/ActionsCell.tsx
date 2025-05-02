import React from 'react';

// material-ui
import {
  IconButton,
  List,
  styled,
} from '@mui/joy';
import {
  Unstable_Popup as BasePopup,
  ClickAwayListener,
} from '@mui/base';

// icons
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';

// common actions
import DeleteAction from './actions/DeleteAction';
import { ObjectMeta } from 'kubernetes-types/meta/v1';

// type Action = {
//   /** 
//    * The name to display for the action 
//    */
//   label: string;
//
//   /** 
//    * The icon name to use for the action menu 
//    */
//   icon: string;
//
//   /** 
//    * Callback function that the handler gets called with. It will be passed the raw
//    * object as the first and only parameter
//    */
//   handler: (data: unknown) => void
// }

type Props = {
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  data: unknown;
  // actions: Array<Action>
  namespace: string
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
        variant="plain"
        sx={{
          flex: 'none',
          minHeight: 28,
          minWidth: 28,
        }}
        onClick={handleClick}
      >
        <MoreHorizRoundedIcon />
      </IconButton>
      <BasePopup
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
            }} />
          </PopupBody>
        </ClickAwayListener>
      </BasePopup>
    </>
  );
};

const ActionsMenuList: React.FC<ActionMenuListProps> = ({
  connectionID,
  resourceKey,
  namespace,
  data,
  dismissMenu,
}) => {
  // TODO: refactor this to allow for nested menus
  // const [menuSelected, setMenuSelected] = React.useState<undefined | string>(undefined);
  //

  // not the same as resource id
  const resourceName = (data as { metadata?: ObjectMeta }).metadata?.name || ''

  return (
    <List
      size='sm'
      variant="outlined"
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
      {/* {actions.exec && <ExecAction */}
      {/*   selected={menuSelected === 'exec'} */}
      {/*   handleSelect={() => { */}
      {/*     setMenuSelected('exec'); */}
      {/*   }} */}
      {/*   handleDeselect={() => { */}
      {/*     setMenuSelected(undefined); */}
      {/*   }} */}
      {/*   handleLeaveMenu={createHandleLeaveMenu('exec')} */}
      {/*   handleDismiss={dismissMenu} */}
      {/*   itemProps={itemProps} */}
      {/*   action={actions.exec} */}
      {/*   plugin={'kubernetes'} */}
      {/*   connection={connection} */}
      {/*   resource={resource} */}
      {/*   data={data} */}
      {/* />} */}
      <DeleteAction
        connectionID={connectionID}
        resourceID={resourceName}
        namespace={namespace}
        resourceKey={resourceKey}
        // handleSelect={() => {
        //   setMenuSelected('delete');
        // }}
        // handleDeselect={() => {
        //   setMenuSelected(undefined);
        // }}
        handleDismiss={dismissMenu}
      />
    </List>
  );
};

ActionMenu.displayName = 'ActionMenu';
export default ActionMenu;
