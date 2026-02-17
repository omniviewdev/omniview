import React from 'react';
import { IconButton, List, styled } from '@mui/joy';
import { Unstable_Popup as BasePopup, ClickAwayListener } from '@mui/base';
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
  background-color: ${theme.palette.background.popup};
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
        variant="plain"
        sx={{ flex: 'none', minHeight: 28, minWidth: 28 }}
        onClick={handleClick}
      >
        <MoreHorizRounded />
      </IconButton>
      <BasePopup
        style={{ zIndex: 9999 }}
        id={'resource-context-menu'}
        open={open}
        anchor={selected}
        placement={'bottom-end'}
      >
        <ClickAwayListener onClickAway={() => { setSelected(null); }}>
          <PopupBody>
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
              }}
            >
              {/* AWS plugin is read-only, no actions yet */}
            </List>
          </PopupBody>
        </ClickAwayListener>
      </BasePopup>
    </>
  );
};

ActionsCell.displayName = 'ActionsCell';
export default ActionsCell;
