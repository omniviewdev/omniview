import React from 'react';
import { Select } from '@omniviewdev/ui/inputs';
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
    newValue: string | string[],
  ) => {
    setNamespaces(Array.isArray(newValue) ? newValue : [newValue]);
  };

  return (
    <Select
      size='xs'
      multiple
      searchable
      value={selected}
      onChange={handleChange}
      placeholder='All Namespaces'
      sx={{
        minWidth: 160,
        maxWidth: 280,
        '& .MuiSelect-select': {
          py: '2px !important',
        },
      }}
      options={namespaceNames.map((ns: string) => ({
        value: ns,
        label: ns,
      }))}
    />
  );
};

export default NamespaceSelect;
