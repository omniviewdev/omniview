import React from 'react'

import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withNamespacedResourceColumns } from '../shared/columns'
import { KubernetesResourceObject } from '../../../../types/resource';
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuContainer } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string, resourceKey: string }>()
  const key = resourceKey.replace(/_/g, '::')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withNamespacedResourceColumns([], { connectionID: id, resourceKey }),
    [],
  )

  const drawer: DrawerComponent<KubernetesResourceObject> = React.useMemo(() => ({
    title: key, // TODO: change runtime sdk to accept a function
    icon: <LuContainer />,
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
      resourceKey={key}
      idAccessor='metadata.name'
      memoizer={'metadata.uid,metadata.resourceVersion'}
      drawer={drawer}
    />
  )
}

export default DefaultTable;
