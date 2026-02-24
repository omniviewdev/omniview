import React from 'react';
import List from '@mui/material/List';
import Popper from '@mui/material/Popper';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { styled } from '@mui/material/styles';
import { IconButton } from '@omniviewdev/ui/buttons';
import { MoreHorizRounded } from '@mui/icons-material';

type Props = {
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  data: unknown;
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
  font-size: 0.875rem;
  z-index: 1;
`,
);

const ActionsCell: React.FC<Props> = () => {
  const [selected, setSelected] = React.useState<HTMLElement | null>(null);

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    setSelected(selected ? null : event.currentTarget);
  }, [selected]);

  const open = Boolean(selected);

  React.useEffect(() => {
    const handleScroll = () => { setSelected(null); };
    window.addEventListener('scroll', handleScroll, true);
    return () => { window.removeEventListener('scroll', handleScroll, true); };
  }, []);

  return (
    <>
      <IconButton
        size="sm"
        emphasis="ghost"
        sx={{ flex: 'none', minHeight: 28, minWidth: 28 }}
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
        <ClickAwayListener onClickAway={() => { setSelected(null); }}>
          <PopupBody>
            <List
              dense
              sx={{
                maxWidth: 400,
                minWidth: 110,
                borderRadius: 1,
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                py: 0,
                px: '2px',
              }}
            >
              {/* AWS plugin is read-only, no actions yet */}
            </List>
          </PopupBody>
        </ClickAwayListener>
      </Popper>
    </>
  );
};

ActionsCell.displayName = 'ActionsCell';
export default ActionsCell;
