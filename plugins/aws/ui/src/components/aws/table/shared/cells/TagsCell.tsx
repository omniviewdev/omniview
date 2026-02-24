import React from 'react';
import { Stack } from '@omniviewdev/ui/layout';
import { Chip } from '@omniviewdev/ui';
import { Tooltip } from '@omniviewdev/ui/overlays';

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
        <Tooltip key={i} title={`${tag.Key}=${tag.Value}`}>
          <Chip size='sm' variant='filled' color='default' label={tag.Key} sx={{ borderRadius: 1, maxWidth: 120 }} />
        </Tooltip>
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outlined' color='default' label={`+${remaining}`} sx={{ borderRadius: 1 }} />
      )}
    </Stack>
  );
};

export default TagsCell;
