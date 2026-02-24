import React from 'react';

// material ui
import { IconButton } from '@omniviewdev/ui/buttons';
import { DropdownMenu } from '@omniviewdev/ui/menus';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';

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
    <div
      style={{ display: 'flex', flex: 1 }}
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
    >
      <IconButton
        size="sm"
        emphasis="ghost"
        color="neutral"
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
          <Text sx={{ pl: 0.5 }} size='sm'>{children}</Text>
        </Stack>
      </IconButton>
      {open && React.cloneElement(menu, {
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
    </div>
  );
}

ActionMenuListItem.displayName = 'ActionMenuListItem';

export default ActionMenuListItem;
