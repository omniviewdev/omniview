import React from 'react';

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Popper from '@mui/material/Popper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';

import { LuColumns2, LuSettings2 } from 'react-icons/lu';
import { type Column } from '@tanstack/react-table';

const PopupBody = styled('div')(({ theme }) => ({
  width: 'max-content',
  borderRadius: '8px',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.palette.mode === 'dark'
    ? '0px 4px 8px rgb(0 0 0 / 0.7)'
    : '0px 4px 8px rgb(0 0 0 / 0.1)',
  fontFamily: 'var(--ov-font-ui)',
  fontSize: '0.875rem',
  zIndex: 1,
}));

type Props = {
  anchorEl: HTMLElement | undefined;
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

const ColumnFilter: React.FC<Props> = ({ anchorEl, columns, onClose, onClick }) => {
  const open = Boolean(anchorEl);

  return (
    <React.Fragment>
      <IconButton
        size="small"
        onClick={onClick}
        sx={{ border: '1px solid', borderColor: 'divider' }}
      >
        <LuSettings2 size={20} />
      </IconButton>
      <Popper
        style={{ zIndex: 1000 }}
        id="table-filter-menu"
        open={open}
        anchorEl={anchorEl}
        placement="bottom-end"
      >
        <ClickAwayListener
          onClickAway={() => { onClose(); }}
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
              <Stack direction="row" spacing={0.5} alignItems="center" px={1} pt={0.5}>
                <LuColumns2 size={14} />
                <Typography variant="subtitle2">Columns</Typography>
              </Stack>
              <Divider />
              <CardContent
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                }}
              >
                {columns.filter(col => col.getCanHide()).map((column) => (
                  <Stack
                    key={column.columnDef.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    component="label"
                    sx={{ cursor: 'pointer' }}
                  >
                    <Switch
                      size="small"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    <Typography variant="caption">
                      {column.columnDef.header?.toString()}
                    </Typography>
                  </Stack>
                ))}
              </CardContent>
            </Card>
          </PopupBody>
        </ClickAwayListener>
      </Popper>
    </React.Fragment>
  );
};

ColumnFilter.displayName = 'ColumnFilter';

export default ColumnFilter;
