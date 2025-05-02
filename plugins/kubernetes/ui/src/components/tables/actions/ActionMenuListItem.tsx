import React from 'react';

// material ui
import {
  Dropdown,
  MenuButton,
  IconButton,
  Typography,
  Stack,
} from '@mui/joy';

type ActionMenuListItemProps = {
  icon: React.ReactElement;
  menu: React.ReactElement;
  open: boolean;
  onOpen: (
    event?:
      | React.MouseEvent<HTMLButtonElement>
      | React.KeyboardEvent<HTMLButtonElement>,
  ) => void;
  onLeaveMenu: (callback: () => boolean) => void;
  label: string;
} & React.HTMLAttributes<HTMLButtonElement>;

const modifiers = [
  {
    name: 'offset',
    options: {
      offset: ({ placement }: any) => {
        if (placement.includes('end')) {
          return [4, 8];
        }

        return [-4, 8];
      },
    },
  },
];

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
  const internalOpen = React.useRef(open);

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    internalOpen.current = open;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onOpen(event);
    }
  };

  return (
    <Dropdown
      open={open}
      onOpenChange={(_, isOpen) => {
        if (isOpen) {
          onOpen?.();
        }
      }}
    >
      <MenuButton
        size="sm"
        slots={{ root: IconButton }}
        slotProps={{ root: { variant: 'plain', color: 'neutral', width: '100%', borderRadius: '2px' } }}
        onMouseDown={() => {
          internalOpen.current = open;
        }}
        onClick={() => {
          if (!internalOpen.current) {
            onOpen();
          }
        }}
        onMouseEnter={() => {
          onOpen();
          isOnButton.current = true;
        }}
        onMouseLeave={() => {
          isOnButton.current = false;
        }}
        onKeyDown={handleButtonKeyDown}
        sx={{
          display: 'flex',
          flex: 1,
          borderRadius: '2px',
          bgcolor: open ? 'neutral.plainHoverBg' : undefined,
          '&:focus-visible': {
            bgcolor: 'neutral.plainHoverBg',
          },
        }}
      >
        <Stack
          direction='row'
          spacing={1}
          flex={1}
          px={1}
          alignItems={'center'}
          justifyContent='flex-start'>
          {icon}
          <Typography sx={{ pl: 0.5 }} level='body-sm'>{children}</Typography>
        </Stack>
      </MenuButton>
      {React.cloneElement(menu, {
        onMouseLeave: () => {
          onLeaveMenu(() => isOnButton.current);
        },
        modifiers,
        size: 'sm',
        slotProps: {
          listbox: {
            id: `resource-action-submenu-${label}`,
            'aria-label': label,
          },
        },
        placement: 'left-start',
      })}
    </Dropdown>
  );
}

ActionMenuListItem.displayName = 'ActionMenuListItem';

export default ActionMenuListItem;
