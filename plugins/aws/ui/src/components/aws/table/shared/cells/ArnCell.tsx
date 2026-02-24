import React from 'react';
import { Text } from '@omniviewdev/ui/typography';
import { Tooltip } from '@omniviewdev/ui/overlays';

type Props = {
  value: string | undefined;
};

const ArnCell: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  // Show just the resource part of the ARN
  const parts = value.split(':');
  const short = parts.length > 5 ? parts.slice(5).join(':') : value;

  return (
    <Tooltip title={value}>
      <Text size="xs" sx={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {short}
      </Text>
    </Tooltip>
  );
};

export default ArnCell;
