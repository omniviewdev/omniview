import React from 'react';

// Material-ui
import {
  Box,
  Chip,
  ChipDelete,
  Option,
  Select,
  Typography,
} from '@mui/joy';

// Icons
import { LuGroup } from 'react-icons/lu';


type Props = {
  /** The available namespaces. */
  available: string[];

  /** The currently selected namespaces. */
  selected: string[];

  /** Set the selected namespaces. */
  setNamespaces: (namespaces: string[]) => void;
};

/**
  * Renders a select for choosing namespaces.
  */
const NamespaceSelect: React.FC<Props> = ({ available, selected, setNamespaces }) => {
  const handleChange = (
    _event: any,
    newValue: string[] | undefined,
  ) => {
    setNamespaces(newValue ?? []);
  };

  const handleDelete = (namespace: string) => {
    setNamespaces(selected.filter(n => n !== namespace));
  };

  return (
    <Select
      size='sm'
      multiple
      startDecorator={<LuGroup />}
      value={selected}
      onChange={handleChange}
      placeholder={
        <Chip variant='soft' color='neutral' sx={{ borderRadius: 2 }}>
          All Namespaces
        </Chip>
      }
      renderValue={selected => (
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          {selected.map(selectedOption => (
            <Chip
              variant='outlined'
              color='neutral'
              endDecorator={
                <ChipDelete onDelete={(event) => {
                  event.stopPropagation();
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
        maxHeight: 30,
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
      {available.map(ns => (
        <Option key={ns} value={ns}>
          <Typography level='body-sm'>{ns}</Typography>
        </Option>
      ))}
    </Select>
  );
};

export default NamespaceSelect;
