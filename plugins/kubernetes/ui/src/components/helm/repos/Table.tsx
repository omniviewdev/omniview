import React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useParams } from 'react-router-dom';
import ResourceTable from '../../shared/table/ResourceTable';
import { DrawerComponent } from '@omniviewdev/runtime';
import { LuBox, LuCode } from 'react-icons/lu';
import { SiHelm } from 'react-icons/si';
import RepoSidebar from './RepoSidebar';
import BaseEditorPage from '../../shared/sidebar/pages/editor/BaseEditorPage';

const resourceKey = 'helm::v1::Repository';

type HelmRepo = Record<string, any>;

const HelmRepoTable: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();

  const columns = React.useMemo<Array<ColumnDef<HelmRepo>>>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorKey: 'name',
        size: 200,
      },
      {
        id: 'url',
        header: 'URL',
        accessorKey: 'url',
        size: 400,
      },
    ],
    [],
  );

  const drawer: DrawerComponent<HelmRepo> = React.useMemo(() => ({
    title: 'Repository',
    icon: <SiHelm />,
    views: [
      {
        title: 'Overview',
        icon: <LuBox />,
        component: (ctx) => <RepoSidebar ctx={ctx} />,
      },
      {
        title: 'Editor',
        icon: <LuCode />,
        component: (ctx) => <BaseEditorPage data={ctx.data || {}} />,
      },
    ],
    actions: [],
  }), []);

  return (
    <ResourceTable
      columns={columns}
      connectionID={id}
      resourceKey={resourceKey}
      idAccessor="name"
      memoizer="name"
      drawer={drawer}
    />
  );
};

export default HelmRepoTable;
