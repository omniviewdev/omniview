import { useEffect, useMemo, useState } from 'react';
import { type Row, type Table } from '@tanstack/react-table';

import {
  Typography, 
  Box, 
  Checkbox, 
  Dropdown, 
  MenuButton, 
  Menu, 
  MenuItem, 
  Divider, 
  IconButton,
} from '@mui/joy';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import {
  LuChevronsLeftRight, LuFileCog, LuInspect, LuScrollText, LuTerminalSquare } from 'react-icons/lu';
import { formatTimeDifference } from '@/utils/time';

/**
 * Render a standard text row for the generic resource table.
 */
export const TextRow = ({ row, column }: { row: Row<any>; column: string }) => <Typography level='body-xs' noWrap>{row.getValue(column)}</Typography>;
export const NumberRow = ({ row, column }: { row: Row<any>; column: string }) => <Typography level='body-xs' noWrap>{row.getValue(column) ?? 0}</Typography>;

/**
 * Render a selectbox for the header of the generic resource table.
 */
export const SelectBoxHeader = ({ table }: { table: Table<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24 }}>
    <Checkbox
      size='sm'
      checked={table.getIsAllPageRowsSelected()}
      onChange={event => {
        table.toggleAllPageRowsSelected(event.target.checked); 
      }}
      aria-label='Select all nodes'
    />
  </Box>
);

/**
 * Render a selectbox for a row of the generic resource table.
 */
export const SelectBoxRow = ({ row }: { row: Row<any> }) => (
  <Box sx={{
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', maxWidth: 24 }}>
    <Checkbox
      size='sm'
      checked={row.getIsSelected()}
      onChange={event => {
        row.toggleSelected(event.target.checked); 
      }}
      aria-label='Select node'
    />
  </Box>
);

export function RowMenu() {
  return (
    <Dropdown>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{ root: { variant: 'plain', color: 'neutral', size: 'sm' } }}
      >
        <MoreHorizRoundedIcon />
      </MenuButton>
      <Menu size='sm' sx={{ minWidth: 140 }}>
        <MenuItem><LuFileCog />Spec</MenuItem>
        <MenuItem><LuScrollText />Logs</MenuItem>
        <MenuItem><LuInspect />Attach</MenuItem>
        <MenuItem><LuTerminalSquare />Exec</MenuItem>
        <MenuItem><LuChevronsLeftRight />Edit</MenuItem>
        <Divider />
        <MenuItem color='danger'> Delete</MenuItem>
      </Menu>
    </Dropdown>
  );
}

export const Age = ({ startTime }: { startTime: string }) => {
  // Memoize the initial age calculation
  const initialAge = useMemo(() => {
    const date = new Date(startTime);
    if (!startTime || isNaN(date.getTime())) {
      return '0s';
    }

    return formatTimeDifference(date);
  }, [startTime]);

  const [time, setTime] = useState(initialAge);

  useEffect(() => {
    const date = new Date(startTime);
    if (isNaN(date.getTime())) {
      // Early return if startTime is not a valid date
      return;
    }

    const updateAge = () => {
      setTime(formatTimeDifference(date)); 
    };

    // Set the interval to update the age every 60 seconds
    const intervalId = setInterval(updateAge, 1000); // Adjusted to 60 seconds

    // Cleanup the interval on component unmount
    return () => {
      clearInterval(intervalId); 
    };
  }, [startTime, initialAge]);

  return <Typography level='body-xs'>{time}</Typography>;
};

export const StatusText = ({ status }: { status: string | undefined }) => {
  if (!status) {
    return null;
  }

  return (
    <Typography
      level='body-xs'
      color={{
        Running: 'success',
        Pending: 'warning',
        Failed: 'danger',
        Succeeded: 'neutral',
      }[status] as 'success' | 'warning' | 'danger' | 'neutral'}
    >
      {status}
    </Typography>
  );
};
