import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Select } from '@omniviewdev/ui/inputs';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';

// Icons
import { LuGroup } from 'react-icons/lu';

type Props = {
  /** The current selected values */
  values: string[];
  /** The available options */
  options: string[];
  /** Set the selected values */
  onChange: (value: string[]) => void;
  /** Optional placeholder text */
  placeholder?: string;
};

/**
 * Renders a select for choosing multiple values from a list of options.
 */
const MultipleSelect: React.FC<Props> = ({ values, options, onChange, placeholder }) => {

  const handleChange = (
    _event: any,
    newValue: string[] | undefined,
  ) => {
    onChange(newValue ?? []);
  };

  const handleDelete = (val: string) => {
    onChange(values.filter(v => v !== val));
  };

  return (
    <Select
      multiple
      startAdornment={<LuGroup />}
      value={values}
      onChange={handleChange}
      placeholder={
        placeholder && (
          <Chip emphasis='soft' color='neutral' label={placeholder} sx={{ borderRadius: 2 }} />
        )
      }
      renderValue={selected => (
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          {selected.map(selectedOption => (
            <Chip
              emphasis='outline'
              color='neutral'
              label={selectedOption.label}
              onDelete={() => {
                handleDelete(selectedOption.value);
              }}
              sx={{
                borderRadius: 2,
              }}
            />
          ))}
        </Box>
      )}
      sx={{
        minWidth: '20rem',
        pt: 0,
        pb: 0,
      }}
      slotProps={{
        listbox: {
          placement: 'bottom-end',
          sx: {
            '--ListDivider-gap': 0,
            width: '20rem',
            maxWidth: '20rem',
          },
        },
      }}
      options={options.map(o => ({
        value: o,
        label: o,
      }))}
    />
  );
};

export default MultipleSelect;
