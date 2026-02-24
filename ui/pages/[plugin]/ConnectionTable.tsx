import * as React from 'react';

// material ui
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';

// types
import { type types } from '@omniviewdev/runtime/models';

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
    <Box
      sx={{
        width: '100%',
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <table
        aria-label='connections table'
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          WebkitUserSelect: 'none',
        }}
      >
        <thead>
          <tr>
            <th style={{ width: '40%', verticalAlign: 'middle' }}>
              <Text sx={{ pl: 0.5 }}>Name</Text>
            </th>
            {Object.entries(getConnectionOrderedLabelCols(connections)).sort().map(([label, width]) => (
              <th key={label} style={{ width: width + 8, verticalAlign: 'middle', paddingLeft: 4 }}>
                <Text sx={{ pl: 1 }}>{label.replace(/(\w)(\w*)/g,
                  function (_, g1?: string, g2?: string) {
                    return (g1?.toUpperCase() ?? '') + (g2?.toLowerCase() ?? '');
                  })}</Text>
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
      </table>
    </Box>
  );
};

export default ConnectionTable;
