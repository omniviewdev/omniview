import React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import MuiTextField from '@mui/material/TextField';
import { Chip } from '@omniviewdev/ui';

type Props = {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
};

const TagInput: React.FC<Props> = ({ tags, availableTags, onChange }) => {
  // Combine existing tags with available suggestions, deduped
  const options = [...new Set([...availableTags, ...tags])].sort();

  return (
    <Autocomplete
      multiple
      freeSolo
      size='small'
      value={tags}
      options={options}
      onChange={(_e, newValue) => {
        onChange(newValue.map(v => (typeof v === 'string' ? v.trim() : v)).filter(Boolean));
      }}
      renderTags={(value, getTagProps) =>
        value.map((tag, index) => {
          const { onDelete, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              size='sm'
              emphasis='soft'
              color='warning'
              label={tag}
              {...tagProps}
              onDelete={() => onDelete({} as any)}
              key={tag}
            />
          );
        })
      }
      renderInput={(params) => (
        <MuiTextField {...params} placeholder='Add tags...' size='small' />
      )}
    />
  );
};

export default TagInput;
