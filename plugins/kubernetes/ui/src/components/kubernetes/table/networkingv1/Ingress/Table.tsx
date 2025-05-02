import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Ingress } from 'kubernetes-types/networking/v1'
import { useParams } from 'react-router-dom'
import ResourceTable from '../../../../shared/table/ResourceTable'
import { withNamespacedResourceColumns } from '../../shared/columns'
import { DrawerComponent } from '@omniviewdev/runtime'
import { LuBox } from 'react-icons/lu'
import IngressSidebar from '../../../sidebar/Ingress'

const resourceKey = 'networking::v1::Ingress'

const IngressTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>()

  const columns = React.useMemo<Array<ColumnDef<Ingress>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: resourceKey, // TODO: change runtime sdk to accept a function
    icon: <LuBox />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (data: any) => <IngressSidebar data={data} />
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

export default IngressTable
