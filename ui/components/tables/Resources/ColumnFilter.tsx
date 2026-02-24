import React from 'react';


// material-ui
import { Card } from '@omniviewdev/ui';
import Divider from '@mui/material/Divider';
import { Text } from '@omniviewdev/ui/typography';
import { Popover } from '@omniviewdev/ui/overlays';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Checkbox } from '@omniviewdev/ui/inputs';
import { styled } from '@mui/material/styles';

// icons
import { LuColumns2, LuSettings2 } from 'react-icons/lu';
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
        emphasis='outline'
        color='neutral'
        onClick={onClick}
      >
        <LuSettings2 size={20} />
      </IconButton>
      <Popover
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
              emphasis="outline"
              sx={{
                maxHeight: 'max-content',
                maxWidth: '100%',
                minWidth: '300px',
                p: 1.25,
                gap: 1.25,
              }}
            >
              <Text weight="semibold" size="sm"><LuColumns2 size={14}/> Columns</Text>
              <Divider/>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {columns.filter(col => col.getCanHide()).map((column) => (
                  <label
                    key={column.columnDef.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}
                  >
                    <Checkbox size='sm' checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />
                    {column.columnDef.header?.toString()}
                  </label>
                ))}
              </div>
            </Card>
          </PopupBody>
        </ClickAwayListener>
      </Popover>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
