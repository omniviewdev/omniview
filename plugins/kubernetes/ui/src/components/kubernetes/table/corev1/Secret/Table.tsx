import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Secret } from 'kubernetes-types/core/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCircleCheck } from 'react-icons/lu'
import SecretSidebar from '../../../sidebar/SecretSidebar'
import { createStandardViews } from '../../../../shared/sidebar/createDrawerViews'
import { Chip } from '@omniviewdev/ui'
import { Stack } from '@omniviewdev/ui/layout'

const resourceKey = 'core::v1::Secret'

const SecretTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Secret>>>(
    () => withNamespacedResourceColumns<Secret>([
      {
        id: 'type',
        header: 'Type',
        accessorKey: 'type',
      },
      {
        id: 'immutable',
        header: 'Immmutable',
        accessorFn: (row) => !!row.immutable,
        cell: ({ getValue }) => (getValue() as boolean) ? <LuCircleCheck /> : '',
        meta: {
          defaultHidden: true,
        }
      },
      {
        id: 'keys',
        header: 'Keys',
        accessorFn: (row) => ([...Object.keys(row.data || []), ...Object.keys(row.stringData || [])]),
        cell: ({ getValue }) => {
          return (
            <Stack
              direction={'row'}
              overflow={'scroll'}
              gap={0.25}
              sx={{
                scrollbarWidth: "none",
                // hide scrollbar
                "&::-webkit-scrollbar": {
                  display: "none",
                },
              }}>
              {(getValue() as string[]).map((value) => <Chip size={'sm'} sx={{ borderRadius: '2px' }} emphasis='outline' label={value} />)}
            </Stack>
          )
        },
        size: 200,
        meta: {
          flex: 1
        }
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Secret> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: createStandardViews({ SidebarComponent: SecretSidebar }),
    actions: []
  }), [])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor='metadata.uid'
      memoizer='metadata.uid,metadata.resourceVersion'
      drawer={drawer}
    />
  )
}

export default SecretTable
