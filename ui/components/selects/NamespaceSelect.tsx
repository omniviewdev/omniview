import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Select } from '@omniviewdev/ui/inputs';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';

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
      multiple
      startAdornment={<LuGroup />}
      value={selected}
      onChange={handleChange}
      placeholder={
        <Chip emphasis='soft' color='neutral' label="All Namespaces" sx={{ borderRadius: 2 }} />
      }
      renderValue={selected => (
        <Box sx={{ display: 'flex', gap: '0.25rem' }}>
          {selected.map(selectedOption => (
            <Chip
              emphasis='outline'
              color='neutral'
              label={selectedOption.label}
              onDelete={(event) => {
                event.stopPropagation();
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
      options={available.map(ns => ({
        value: ns,
        label: ns,
      }))}
    />
  );
};

export default NamespaceSelect;
