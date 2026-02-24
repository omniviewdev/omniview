import * as React from 'react';

// Material-ui
import Menu from '@mui/material/Menu';
import MuiMenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import { IconButton } from '@omniviewdev/ui/buttons';

// Project imports
import Icon from '@/components/icons/Icon';
import { type HeaderIconMenuItem, type HeaderIconMenu as HeaderIconMenuProps } from '@/store/header/types';
import { WithConditionalTooltip } from './HeaderIconLink';
import { WithConditionalLink } from '../HeaderContextArea';

type Props = HeaderIconMenuProps;

/**
 * Display a drop down menu as a header icon
 */
const HeaderIconMenu: React.FC<Props> = ({ id, icon, helpText, items }) => (
  <MenuComponent
    id={id}
    control={
      <WithConditionalTooltip helpText={helpText}>
        <IconButton
          size='sm'
          emphasis='soft'
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

function MenuComponent({
  control,
  menus,
  id,
}: {
  control: React.ReactElement;
  id: string;
  menus: HeaderIconMenuItem[];
}) {
  const [buttonElement, setButtonElement]
    = React.useState<HTMLButtonElement | null>(null);
  const [isOpen, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const preventReopen = React.useRef(false);

  const updateAnchor = React.useCallback((node: HTMLButtonElement | null) => {
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
    }
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
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
      <Menu
        id={id}
        open={isOpen}
        onClose={close}
        anchorEl={buttonElement}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ minWidth: 120 }}
      >
        {menus.map(({ label, icon, link }) => (
          <WithConditionalLink link={link} key={label}>
            <MuiMenuItem
              onClick={close}
            >
              {icon && (
                <ListItemIcon>
                  <Icon name={icon} />
                </ListItemIcon>
              )}
              {label}
            </MuiMenuItem>
          </WithConditionalLink>
        ))}
      </Menu>
    </>
  );
}

export default HeaderIconMenu;
