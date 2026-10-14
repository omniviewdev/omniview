import React from 'react';
import { Text } from '@omniviewdev/base-ui';
import { SimpleTooltip } from '../../../../shared/ui/SimpleTooltip';

type Props = {
  value: string | undefined;
};

const textStyle: React.CSSProperties = { maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

const ArnCell: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  // Show just the resource part of the ARN
  const parts = value.split(':');
  const short = parts.length > 5 ? parts.slice(5).join(':') : value;

  return (
    <SimpleTooltip title={value}>
      <Text size="xs" style={textStyle}>
        {short}
      </Text>
    </SimpleTooltip>
  );
};

export default ArnCell;
