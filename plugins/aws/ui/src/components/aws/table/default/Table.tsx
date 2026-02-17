import React from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { useParams } from 'react-router-dom';
import ResourceTable from '../../../shared/table/ResourceTable';
import { withRegionalResourceColumns } from '../shared/columns'
import BaseEditorPage from '../../../shared/sidebar/pages/editor/BaseEditorPage';
import { LuCode, LuBox } from 'react-icons/lu';
import { DrawerComponent } from '@omniviewdev/runtime';

const DefaultTable: React.FC = () => {
  const { id = '', resourceKey = '' } = useParams<{ id: string, resourceKey: string }>()
  const key = resourceKey.replace(/_/g, '::')

  const columns = React.useMemo<Array<ColumnDef<any>>>(
    () => withRegionalResourceColumns([], { connectionID: id, resourceKey: key }),
    [id, key],
  )

  const drawer: DrawerComponent = React.useMemo(() => ({
    title: key,
    icon: <LuBox />,
    views: [
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />
      }
    ],
    actions: []
  }), [key])

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={key}
      idAccessor='_id'
      memoizer='_id'
      drawer={drawer}
    />
  )
}

export default DefaultTable;
