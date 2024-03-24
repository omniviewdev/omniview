import * as React from 'react';

// Material-ui
import JoyMenu, { type MenuActions } from '@mui/joy/Menu';
import MenuItem from '@mui/joy/MenuItem';
import IconButton from '@mui/joy/IconButton';
import { ListActionTypes } from '@mui/base/useList';

// Project imports
import Icon from '@/components/icons/Icon';
import { type HeaderIconMenuItem, type HeaderIconMenu as HeaderIconMenuProps } from '@/store/header/types';
import { WithConditionalTooltip } from './HeaderIconLink';
import { WithConditionalLink } from '../HeaderContextArea';
import { ListItemDecorator } from '@mui/joy';

type Props = HeaderIconMenuProps;

/**
 * Display a drop down menu as a header icon
 */
const HeaderIconMenu: React.FC<Props> = ({ id, icon, helpText, items }) => (
  <Menu
    id={id}
    control={
      <WithConditionalTooltip helpText={helpText}>
        <IconButton
          size='sm'
          variant='soft'
          color='neutral'
          aria-label='Apps'
          sx={{
            '--wails-draggable': 'no-drag',
          }}
        >
          <Icon name={icon} />
        </IconButton>
      </WithConditionalTooltip>
    }
    menus={items}
  />
);

function Menu({
  control,
  menus,
  id,
}: {
  control: React.ReactElement;
  id: string;
  menus: HeaderIconMenuItem[];
}) {
  const [buttonElement, setButtonElement]
    = React.useState<HTMLButtonElement | undefined>(undefined);
  const [isOpen, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuActions = React.useRef<MenuActions>(null);
  const preventReopen = React.useRef(false);

  const updateAnchor = React.useCallback((node: HTMLButtonElement | undefined) => {
    setButtonElement(node);
  }, []);

  const handleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (preventReopen.current) {
      event.preventDefault();
      preventReopen.current = false;
      return;
    }

    setOpen(open => !open);
  };

  const handleButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (event.key === 'ArrowUp') {
        menuActions.current?.dispatch({
          type: ListActionTypes.keyDown,
          key: event.key,
          event,
        });
      }
    }
  };

  const close = () => {
    setOpen(false);
    buttonRef.current!.focus();
  };

  return (
    <>
      {React.cloneElement(control, {
        type: 'button',
        onClick: handleButtonClick,
        onKeyDown: handleButtonKeyDown,
        ref: updateAnchor,
        'aria-controls': isOpen ? id : undefined,
        'aria-expanded': isOpen || undefined,
        'aria-haspopup': 'menu',
      })}
      <JoyMenu
        id={id}
        placement='bottom-end'
        actions={menuActions}
        open={isOpen}
        onClose={close}
        anchorEl={buttonElement}
        sx={{ minWidth: 120 }}
      >
        {menus.map(({ label, icon, link }) => (
          <WithConditionalLink link={link}>
            <MenuItem
              variant={'plain'}
              onClick={close}
            >
              {icon && (
                <ListItemDecorator>
                  <Icon name={icon} />
                </ListItemDecorator>
              )}
              {label}
            </MenuItem>
          </WithConditionalLink>
        ))}
      </JoyMenu>
    </>
  );
}

export default HeaderIconMenu;
