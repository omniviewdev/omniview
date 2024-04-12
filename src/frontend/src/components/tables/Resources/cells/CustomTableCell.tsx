import React from 'react';

import PluginComponent from '@/federation';

type Props = {
  plugin: string;
  component: string;
  data: unknown;
};

const CustomTableCell: React.FC<Props> = ({ plugin, component, data }) => {
  return (
    <PluginComponent
      plugin={plugin}
      component={component}
      fallback={<React.Fragment />}
      data={data}
    />
  );
};

export default CustomTableCell;
