/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import Box from '@mui/material/Box';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { type Column } from '@tanstack/react-table';
import Filter from './Filter';

type Props = {
  columns: Array<Column<any>>;
};

const FilterDisplay: React.FC<Props> = ({ columns }) => {
  if (columns.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        maxWidth: 350,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {columns.filter((c) => c.columnDef.meta?.filterVariant).map((column, _, arr) => {
        return (
          <Accordion
            key={column.id}
            defaultExpanded={arr.length < 8}
            disableGutters
            sx={{ '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              {column.columnDef.meta?.filterLabel ?? column.columnDef.header as string}
            </AccordionSummary>
            <AccordionDetails>
              <Filter column={column} />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
};

export default FilterDisplay;
