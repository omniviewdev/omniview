import React from 'react';
import { Chip, Stack, Tooltip, Typography } from '@mui/joy';

type Tag = { Key?: string; Value?: string };

type Props = {
  tags: Tag[] | undefined;
  max?: number;
};

const TagsCell: React.FC<Props> = ({ tags, max = 3 }) => {
  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const remaining = tags.length - max;

  return (
    <Stack direction='row' gap={0.5} flexWrap='nowrap' overflow='hidden'>
      {visible.map((tag, i) => (
        <Tooltip key={i} title={`${tag.Key}=${tag.Value}`} size='sm'>
          <Chip size='sm' variant='soft' color='neutral' sx={{ borderRadius: 'sm', maxWidth: 120 }}>
            <Typography level='body-xs' noWrap>{tag.Key}</Typography>
          </Chip>
        </Tooltip>
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outlined' color='neutral' sx={{ borderRadius: 'sm' }}>
          +{remaining}
        </Chip>
      )}
    </Stack>
  );
};

export default TagsCell;
