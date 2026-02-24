import React from 'react';

// @omniviewdev/ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

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

function ActionMenuListItem({
  icon,
  children,
  menu,
  open,
  onOpen,
  onLeaveMenu,
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
    <Box sx={{ position: 'relative' }}>
      <Box
        component='button'
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
          width: '100%',
          borderRadius: '2px',
          bgcolor: open ? 'action.hover' : undefined,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          p: 0,
          '&:focus-visible': {
            bgcolor: 'action.hover',
          },
        }}
      >
        <Stack
          direction='row'
          gap={1}
          sx={{ flex: 1, px: 1, alignItems: 'center', justifyContent: 'flex-start' }}
        >
          {icon}
          <Text sx={{ pl: 0.5 }} size='sm'>{children}</Text>
        </Stack>
      </Box>
      {open && (
        <Box
          onMouseLeave={() => {
            onLeaveMenu(() => isOnButton.current);
          }}
          sx={{
            position: 'absolute',
            right: '100%',
            top: 0,
            zIndex: 10,
          }}
        >
          {menu}
        </Box>
      )}
    </Box>
  );
}

ActionMenuListItem.displayName = 'ActionMenuListItem';

export default ActionMenuListItem;
