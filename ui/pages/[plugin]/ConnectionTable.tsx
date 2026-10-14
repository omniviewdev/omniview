import * as React from 'react';

// ui
import { Text } from '@omniviewdev/base-ui';

// types
import type { Connection } from '@omniviewdev/runtime/models';

// icons
import ConnectionTableItem from './ConnectionTableItem';
import styles from './ConnectionTable.module.css';


type Props = {
  connections: Connection[];
};

const getConnectionOrderedLabelCols = (connections: Connection[]) => {
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
    <div className={styles.Root}>
      <table aria-label='connections table' className={styles.Table}>
        <thead>
          <tr>
            <th style={{ width: '40%', verticalAlign: 'middle' }}>
              <Text className={styles.NameHeader}>Name</Text>
            </th>
            {Object.entries(getConnectionOrderedLabelCols(connections)).sort().map(([label, width]) => (
              <th key={label} style={{ width: width + 8, verticalAlign: 'middle', paddingLeft: 4 }}>
                <Text className={styles.LabelHeader}>{label.replace(/(\w)(\w*)/g,
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
    </div>
  );
};

export default ConnectionTable;
