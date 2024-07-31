/* eslint @typescript-eslint/consistent-type-definitions: 0 */
/* eslint @typescript-eslint/naming-convention: 0 */
import React from 'react';

import AccordionGroup from '@mui/joy/AccordionGroup';
import Accordion from '@mui/joy/Accordion';
import AccordionDetails from '@mui/joy/AccordionDetails';
import AccordionSummary from '@mui/joy/AccordionSummary';

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
    <AccordionGroup
      size="sm"
      variant="outlined"
      transition="0.2s"
      sx={{
        maxWidth: 350,
        borderRadius: 'sm',
      }}
    >
      {columns.filter((c) => c.columnDef.meta?.filterVariant).map((column, _, arr) => {
        return (
          <Accordion
            defaultExpanded={arr.length < 8}
          >
            <AccordionSummary>{column.columnDef.meta?.filterLabel ?? column.columnDef.header as string}</AccordionSummary>
            <AccordionDetails>
              <Filter column={column} />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </AccordionGroup>
  );
};

export default FilterDisplay;
