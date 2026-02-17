import React from 'react';
import { Tooltip, Typography } from '@mui/joy';

type Props = {
  value: string | undefined;
};

const ArnCell: React.FC<Props> = ({ value }) => {
  if (!value) return null;

  // Show just the resource part of the ARN
  const parts = value.split(':');
  const short = parts.length > 5 ? parts.slice(5).join(':') : value;

  return (
    <Tooltip title={value} size='sm'>
      <Typography level='body-xs' noWrap sx={{ maxWidth: 200 }}>
        {short}
      </Typography>
    </Tooltip>
  );
};

export default ArnCell;
