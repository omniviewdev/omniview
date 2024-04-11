import * as React from 'react';

// material ui
import Table from '@mui/joy/Table';
import Typography from '@mui/joy/Typography';
import Sheet from '@mui/joy/Sheet';

// types
import { type types } from '@api/models';

// icons
import ConnectionTableItem from './ConnectionTableItem';


type Props = {
  connections: types.Connection[];
};

const getConnectionOrderedLabelCols = (connections: types.Connection[]) => {
  const px = 7;
  const maxLabelWidth = 400;

  // reduce all the connections to build out the label columns
  let cols: Record<string, number> = {};

  connections.forEach(col => {
    Object.entries(col.labels).forEach(([key, val]) => {
      let currentWidth = cols[key];
      let calcedWidth = val.length * px;

      if (!currentWidth || (currentWidth && currentWidth < calcedWidth)) {
        cols[key] = calcedWidth > maxLabelWidth ? maxLabelWidth : calcedWidth;
      }
    });
  });

  return cols;
};  

/**
 * Main connection table component.
 */
const ConnectionTable: React.FC<Props> = ({ connections }) => {
  return (
    <Sheet
      variant="outlined"
      sx={{ width: '100%', boxShadow: 'sm', borderRadius: 'sm' }}
    >
      <Table
        aria-label='connections table'
        stickyHeader
        hoverRow
        sx={{
          '--TableCell-headBackground':
              'var(--joy-palette-background-level1)',
          '--Table-headerUnderlineThickness': '1px',
          '--TableRow-hoverBackground':
              'var(--joy-palette-background-level1)',
          '--TableCell-paddingY': '2px',
          '--TableCell-paddingX': '8px',
          WebkitUserSelect: 'none',
        }}
      >
        <thead>
          <tr>
            <th style={{ width: '40%', verticalAlign: 'middle' }}>
              <Typography sx={{ pl: 0.5 }}>Name</Typography> 
            </th>
            {Object.entries(getConnectionOrderedLabelCols(connections)).sort().map(([label, width]) => (
              <th key={label} style={{ width: width + 8, verticalAlign: 'middle', paddingLeft: 4 }}>
                <Typography sx={{ pl: 1 }}>{label.replace(/(\w)(\w*)/g,
                  function (_, g1?: string, g2?: string) {
                    return g1?.toUpperCase() ?? '' + g2?.toLowerCase() ?? '';
                  })}</Typography>
              </th>
            ))}
            <th style={{ width: 48 }}></th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => (
            <ConnectionTableItem key={connection.id} {...connection} />
          ))}
        </tbody>
      </Table>
    </Sheet>
  );
};

export default ConnectionTable;
