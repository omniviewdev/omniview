import React from 'react';
import {
  Box,
  Chip,
  ChipDelete,
  Option,
  Select,
  Typography,
} from '@mui/joy';
import { LuGroup } from 'react-icons/lu';
import { useResources } from '@omniviewdev/runtime';

type Props = {
  /** The active connection being used */
  connectionID: string;

  /** The currently selected namespaces. */
  selected: string[];

  /** Set the selected namespaces. */
  setNamespaces: (namespaces: string[]) => void;
};

/**
  * Renders a select for choosing namespaces.
  * Uses useResources to subscribe to namespace informer events for live updates.
  */
const NamespaceSelect: React.FC<Props> = ({ connectionID, selected, setNamespaces }) => {
  const { resources } = useResources({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'core::v1::Namespace',
    idAccessor: 'metadata.name',
  });

  const namespaceNames = React.useMemo(() => {
    const items: Record<string, any>[] = resources.data?.result ?? [];
    return items
      .map(ns => ns.metadata?.name as string)
      .filter(Boolean)
      .sort();
  }, [resources.data]);

  const handleChange = (
    _event: unknown,
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
              key={selectedOption.value}
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
      {namespaceNames.map(ns => (
        <Option key={ns} value={ns}>
          <Typography level='body-sm'>{ns}</Typography>
        </Option>
      ))}
    </Select>
  );
};

export default NamespaceSelect;
