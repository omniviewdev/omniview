import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { PriorityLevelConfiguration } from 'kubernetes-types/flowcontrol/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withClusterResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox, LuCode } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'

const resourceKey = 'flowcontrol::v1::PriorityLevelConfiguration'

const IngressTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<PriorityLevelConfiguration>>>(
    () => withClusterResourceColumns([
      {
        id: 'type',
        header: 'Type',
        accessorKey: 'spec.type',
        size: 80,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'assuredConcurrencyShares',
        header: 'Assured CS',
        accessorKey: 'spec.limited.assuredConcurrencyShares',
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'nominalConcurrencyShares',
        header: 'Nominal CS',
        accessorKey: 'spec.exempt.nominalConcurrencyShares',
        size: 100,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'lendablePercent',
        header: 'Lendable',
        size: 100,
        accessorFn: (row) => {
          let val = row?.spec?.type === 'Limited' ? row.spec?.limited?.lendablePercent : row.spec?.exempt?.lendablePercent
          return val != undefined ? `${val}%` : undefined
        },
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'borrowingLimitPercent',
        header: 'Borrowing Limit',
        accessorKey: 'spec.limited.borrowingLimitPercent',
        accessorFn: (row) => {
          const val = row.spec?.limited?.borrowingLimitPercent
          return val != undefined ? `${val}%` : undefined
        },
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'limitResponseType',
        header: 'Limit Reponse Type',
        accessorKey: 'spec.limited.limitResponse.type',
        meta: {
          defaultHidden: false,
        }
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<PriorityLevelConfiguration> = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      }
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

export default IngressTable
