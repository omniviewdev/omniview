import React from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import Chip from '@mui/joy/Chip';
import ChipDelete from '@mui/joy/ChipDelete';
import Typography from '@mui/joy/Typography';

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
      startDecorator={<LuGroup />}
      value={values}
      onChange={handleChange}
      placeholder={
        placeholder && (
          <Chip variant='soft' color='neutral' sx={{ borderRadius: 2 }}>
            {placeholder}
          </Chip>
        )
      }
      renderValue={selected => (
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          {selected.map(selectedOption => (
            <Chip
              variant='outlined'
              color='neutral'
              endDecorator={<ChipDelete onDelete={() => {
                handleDelete(selectedOption.value);
              }} />}
              sx={{
                borderRadius: 2,
              }}
            >
              {selectedOption.label}
            </Chip>
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
    >
      {options.map(o => (
        <Option key={o} value={o}>
          <Typography level='body-sm'>{o}</Typography>
        </Option>
      ))}
    </Select>
  );
};

export default MultipleSelect;
