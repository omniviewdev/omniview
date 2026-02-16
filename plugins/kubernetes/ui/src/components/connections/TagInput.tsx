import React from 'react';
import { Autocomplete, Chip, AutocompleteOption, Typography } from '@mui/joy';

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
      size='sm'
      placeholder='Add tags...'
      value={tags}
      options={options}
      onChange={(_e, newValue) => {
        onChange(newValue.map(v => (typeof v === 'string' ? v.trim() : v)).filter(Boolean));
      }}
      renderTags={(value, getTagProps) =>
        value.map((tag, index) => (
          <Chip
            size='sm'
            variant='soft'
            color='warning'
            {...getTagProps({ index })}
            key={tag}
          >
            {tag}
          </Chip>
        ))
      }
      renderOption={(props, option) => (
        <AutocompleteOption {...props} key={option}>
          <Typography level='body-sm'>{option}</Typography>
        </AutocompleteOption>
      )}
    />
  );
};

export default TagInput;
