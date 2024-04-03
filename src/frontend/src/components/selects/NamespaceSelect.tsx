import {
  type FC, useState, useEffect,
} from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import Chip from '@mui/joy/Chip';
import ChipDelete from '@mui/joy/ChipDelete';

// Icons
import { LuGroup } from 'react-icons/lu';

// Backend
import { type Namespace } from 'kubernetes-types/core/v1';
import { List } from '../../../wailsjs/go/resources/NamespaceService';
import { Typography } from '@mui/joy';
import { usePluginRouter } from '@infraview/router';

type Props = {
  /**
   * Manually define the available namespaces. If not defined, the entire namespace
   * scope availabe to the user will be used.
   */
  availableNamespaces?: string[];

  /** The currently selected namespaces. */
  namespaces: string[];

  /** Set the selected namespaces. */
  setNamespaces: (namespaces: string[]) => void;

  /** The available clusters. */
  clusters?: string[];
};

/**
  * Renders a select for choosing namespaces.
  */
const NamespaceSelect: FC<Props> = ({ namespaces, setNamespaces, clusters = [] }) => {
  const [availableNS, setAvailableNS] = useState<string[]>([]);
  const { contextID } = usePluginRouter();

  console.log('namespaces', namespaces);

  useEffect(() => {
    List({
      clusters: clusters?.length ? clusters : [contextID],
      namespaces: [],
      labels: {},
      name: '',
    }).then((namespaces: Record<string, Namespace[]>) => {
      // Reduce down, for now just put it all in the same thing
      setAvailableNS(Object.values(namespaces)
        .flat()
        .map(n => n.metadata?.name)
        .filter(n => n !== undefined)
        .sort() as string[]);
    }).catch(() => {
    // Todo - handle error
    });
  }, []);

  const handleChange = (
    _event: any,
    newValue: string[] | undefined,
  ) => {
    setNamespaces(newValue ?? []);
  };

  const handleDelete = (namespace: string) => {
    setNamespaces(namespaces.filter(n => n !== namespace));
  };

  return (
    <Select
      multiple
      startDecorator={<LuGroup />}
      value={namespaces}
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
      {availableNS.map(ns => (
        <Option key={ns} value={ns}>
          <Typography level='body-sm'>{ns}</Typography>
        </Option>
      ))}
    </Select>
  );
};

export default NamespaceSelect;
