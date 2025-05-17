import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { ConfigMap } from 'kubernetes-types/core/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCircleCheck, LuCode } from 'react-icons/lu'
import ConfigMapSidebar from './Sidebar'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { Chip, Stack } from '@mui/joy'

const resourceKey = 'core::v1::ConfigMap'

const ConfigMapTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<ConfigMap>>>(
    () => withNamespacedResourceColumns([
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
        accessorFn: (row) => ([...Object.keys(row.data || []), ...Object.keys(row.binaryData || [])]),
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
              {(getValue() as string[]).map((value) => <Chip size={'sm'} sx={{ borderRadius: '2px' }} variant='outlined'>{value}</Chip>)}
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

  const drawer: DrawerComponent<ConfigMap> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <ConfigMapSidebar data={ctx.data || {}} />
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      },
    ],
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

export default ConfigMapTable
