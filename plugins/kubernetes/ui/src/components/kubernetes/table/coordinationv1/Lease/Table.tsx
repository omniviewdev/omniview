import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Lease } from 'kubernetes-types/coordination/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCode } from 'react-icons/lu'
import BaseOverviewPage from '../../../../shared/sidebar/pages/overview/BaseOverviewPage'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { Chip } from '@mui/joy'
import AgeCell from '../../shared/cells/AgeCell'

const resourceKey = 'coordination::v1::Lease'

const LeaseTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Lease>>>(
    () => withClusterResourceColumns([
      {
        id: 'holder',
        header: 'Holder',
        accessorKey: 'spec.holderIdentity',
        size: 200,
        cell: ({ getValue }) => <Chip size={'sm'} color={'primary'} sx={{ borderRadius: '2px' }}>{getValue() as string}</Chip>,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'duration',
        header: 'Duration',
        // TODO: change this to format time to nominal
        accessorFn: (row) => `${row.spec?.leaseDurationSeconds || 0}s`,
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'transitions',
        header: 'Transitions',
        accessorFn: (row) => `${row.spec?.leaseTransitions || 0}`,
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'acquireTime',
        header: 'Acquired',
        accessorKey: 'spec.acquireTime',
        cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'renewTime',
        header: 'Renew Time',
        accessorKey: 'spec.renewTime',
        cell: ({ getValue }) => <AgeCell value={getValue() as string} />,
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<Lease> = React.useMemo(() => ({
    title: resourceKey,
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <BaseOverviewPage data={ctx.data || {}} />
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

export default LeaseTable
