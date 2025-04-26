import React from 'react'

import {
  Stack
} from '@mui/joy'
import { DebouncedInput } from './DebouncedInput'
import NamespaceSelect from './NamespaceSelect'
import ColumnFilter from './ColumnFilter'
import { ColumnDef, VisibilityState } from '@tanstack/react-table'

type Props = {
  search: string
  setSearch: (search: string) => void
  searchPlaceholder: string
  availableNamespaces?: string[]
  namespaces?: string[]
  setNamespaces: (namespaces: string[]) => void
  columns: Array<ColumnDef<any>>
  visibility: VisibilityState
  setVisibility: (columnId: string, value: boolean) => void
}

/**
 * Configures the header of the resource table, which includes things like search,
 * filters, etc
 */
const ResourceTableHeader: React.FC<Props> = ({
  search, setSearch, searchPlaceholder,
  namespaces, setNamespaces, availableNamespaces,
  columns,
  visibility, setVisibility,
}) => {
  const [filterAnchor, setFilterAnchor] = React.useState<undefined | HTMLElement>(undefined);

  const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
    setFilterAnchor(filterAnchor ? undefined : event.currentTarget);
  };

  const handleFilterClose = () => {
    setFilterAnchor(undefined);
  };

  return (
    <Stack direction='row' justifyContent={'space-between'} className='NamespaceAndSearch' sx={{ width: '100%' }}>
      <DebouncedInput
        value={search}
        onChange={value => {
          setSearch(String(value));
        }}
        placeholder={searchPlaceholder}
      />
      <Stack direction='row' gap={1}>
        {availableNamespaces && namespaces &&
          <NamespaceSelect
            available={availableNamespaces}
            selected={namespaces}
            setNamespaces={setNamespaces}
          />
        }
        <ColumnFilter
          anchorEl={filterAnchor}
          onClose={handleFilterClose}
          columns={columns}
          visibility={visibility}
          setVisibility={setVisibility}
          onClick={handleFilterClick}
        />
      </Stack>
    </Stack>
  )
}

export default ResourceTableHeader
