import React from 'react';
import { Chip, Stack } from '@omniviewdev/base-ui';
import { SimpleTooltip } from '../../../../shared/ui/SimpleTooltip';
import { chipStyle } from '../../../../shared/ui/colors';

type Tag = { Key?: string; Value?: string };

type Props = {
  tags: Tag[] | undefined;
  max?: number;
};

const tagChipStyle: React.CSSProperties = { ...chipStyle, maxWidth: 120 };

const TagsCell: React.FC<Props> = ({ tags, max = 3 }) => {
  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const remaining = tags.length - max;

  return (
    <Stack direction='row' spacing={1} style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
      {visible.map((tag, i) => (
        <SimpleTooltip key={i} title={`${tag.Key}=${tag.Value}`}>
          <Chip size='sm' variant='solid' color='neutral' style={tagChipStyle}>{tag.Key}</Chip>
        </SimpleTooltip>
      ))}
      {remaining > 0 && (
        <Chip size='sm' variant='outline' color='neutral' style={chipStyle}>{`+${remaining}`}</Chip>
      )}
    </Stack>
  );
};

export default TagsCell;
