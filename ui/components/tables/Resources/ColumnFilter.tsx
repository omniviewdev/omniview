import React from 'react';


// material-ui
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Divider from '@mui/joy/Divider';
import Typography from '@mui/joy/Typography';
import { Unstable_Popup as BasePopup } from '@mui/base/Unstable_Popup';
import { ClickAwayListener } from '@mui/base';
import { IconButton, Switch, styled } from '@mui/joy';

// icons
import { LuColumns, LuSettings2 } from 'react-icons/lu';
import { type Column } from '@tanstack/react-table';

const PopupBody = styled('div')(
  ({ theme }) => `
  width: max-content;
  border-radius: 8px;
  border: 1px solid ${theme.palette.divider};
  background-color: ${theme.palette.background.popup};
  box-shadow: ${ theme.palette.mode === 'dark'
    ? '0px 4px 8px rgb(0 0 0 / 0.7)'
    : '0px 4px 8px rgb(0 0 0 / 0.1)'
};
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 0.875rem;
  z-index: 1;
`,
);

type Props = {
  anchorEl: HTMLElement | undefined;
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
};

const ColumnFilter: React.FC<Props> = ({ anchorEl, columns, onClose, onClick }) => {
  const open = Boolean(anchorEl);

  return (
    <React.Fragment>
      <IconButton
        variant='outlined'
        color='neutral'
        onClick={onClick}
      >
        <LuSettings2 size={20} />
      </IconButton>
      <BasePopup 
        style={{ zIndex: 1000 }} 
        id={'table-filter-menu'}
        open={open} 
        anchor={anchorEl}
        placement='bottom-end'
      >
        <ClickAwayListener 
          onClickAway={() => {
            onClose();
          } }
        >
          <PopupBody>
            <Card
              variant="outlined"
              sx={{
                maxHeight: 'max-content',
                maxWidth: '100%',
                minWidth: '300px',
                p: 1.25,
                gap: 1.25,
              }}
            >
              <Typography startDecorator={<LuColumns size={14}/>} level='title-sm'>Columns</Typography>
              <Divider/>
              <CardContent 
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >
                {columns.filter(col => col.getCanHide()).map((column) => (
                  <Typography
                    key={column.columnDef.id}
                    startDecorator={
                      <Switch sx={{ color: 'primary', mr: 1 }} size='sm' checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />
                    }
                    component='label'
                    level='body-xs'
                  >
                    {column.columnDef.header?.toString()}
                  </Typography>
                ))}
              </CardContent>
            </Card>
          </PopupBody>
        </ClickAwayListener>
      </BasePopup>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
