import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { PriorityClass } from 'kubernetes-types/scheduling/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { CopyableCell } from '../../shared/cells/CopyableCell'
import { withClusterResourceColumns } from '../../shared/columns'
import { LuBox, LuCode } from 'react-icons/lu'
import BaseEditorPage from '../../../../shared/sidebar/pages/editor/BaseEditorPage'
import { DrawerComponent } from '@omniviewdev/runtime'

const resourceKey = 'scheduling::v1::PriorityClass'

const PriorityClassTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<PriorityClass>>>(
    () => withClusterResourceColumns([
      {
        id: 'preemptionPolicy',
        header: 'Preemption Policy',
        accessorKey: 'preemptionPolicy',
        size: 200,
        cell: CopyableCell,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'value',
        header: 'Value',
        accessorKey: 'value',
        size: 200,
        meta: {
          defaultHidden: false,
        }
      },
      {
        id: 'globalDefault',
        header: 'Global Default',
        accessorKey: 'globalDefault',
        size: 200,
        meta: {
          defaultHidden: false,
        }
      },
    ], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<PriorityClass> = React.useMemo(() => ({
    title: resourceKey,
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

export default PriorityClassTable
