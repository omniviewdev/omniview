import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, CircularProgress, Stack, Typography } from '@mui/joy';
import { LuCode, LuContainer, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import get from 'lodash.get';

import ResourceDetailPage from '../../components/shared/detail/ResourceDetailPage';
import FilteredResourceTable from '../../components/shared/table/FilteredResourceTable';
import DetailsCard from '../../components/shared/DetailsCard';
import MetadataSection from '../../components/shared/sidebar/pages/overview/sections/MetadataSection';
import TagsSection from '../../components/aws/sidebar/sections/TagsSection';
import BaseOverviewPage from '../../components/shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../components/shared/sidebar/pages/editor/BaseEditorPage';
import ClusterSettingsForm from '../../components/aws/forms/ecs/ClusterSettingsForm';
import ServiceScalingForm from '../../components/aws/forms/ecs/ServiceScalingForm';
import useResourceForm from '../../components/shared/forms/useResourceForm';
import {
  ecsServiceColumns,
  ecsTaskColumns,
  ecsContainerInstanceColumns,
} from '../../components/aws/table/shared/childColumns';

const resourceKey = 'ecs::v1::Cluster';
const idAccessor = 'ClusterName';

const ECSClusterDetailPage: React.FC = () => {
  const { id = '', resourceId = '' } = useParams<{ id: string; resourceId: string }>();

  const { resources } = useResources({ pluginID: 'aws', connectionID: id, resourceKey, idAccessor });

  const cluster = React.useMemo(
    () => (resources.data?.result || []).find((item: any) => get(item, idAccessor) === resourceId),
    [resources.data?.result, resourceId],
  );

  if (resources.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress size='md' />
      </Box>
    );
  }

  if (!cluster) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography level='body-md' color='neutral'>Cluster not found: {resourceId}</Typography>
      </Box>
    );
  }

  const clusterArn = cluster.ClusterArn || '';

  const { handleSave: handleClusterSave, saving: clusterSaving } = useResourceForm({
    connectionID: id,
    resourceKey,
    resourceID: resourceId,
  });

  const ServiceEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <ServiceScalingForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const serviceDrawer: DrawerComponent = React.useMemo(() => ({
    title: 'ecs::v1::Service', icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: ServiceEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: [],
  }), [ServiceEditView]);

  const serviceFilter = React.useCallback(
    (item: any) => item.ClusterArn === clusterArn,
    [clusterArn],
  );

  const taskFilter = React.useCallback(
    (item: any) => item.ClusterArn === clusterArn,
    [clusterArn],
  );

  const containerInstanceFilter = React.useCallback(
    (item: any) => item.ClusterArn === clusterArn,
    [clusterArn],
  );

  const statusColor = cluster.Status === 'ACTIVE' ? 'success' as const
    : cluster.Status === 'PROVISIONING' ? 'warning' as const
    : cluster.Status === 'FAILED' ? 'danger' as const
    : 'neutral' as const;

  return (
    <ResourceDetailPage
      title={cluster.ClusterName || ''}
      subtitle={cluster.ClusterArn}
      icon={<LuContainer />}
      status={cluster.Status}
      statusColor={statusColor}
      headerDetails={[
        { label: 'Services', value: String(cluster.ActiveServicesCount ?? 0) },
        { label: 'Tasks', value: String(cluster.RunningTasksCount ?? 0) },
        { label: 'Instances', value: String(cluster.RegisteredContainerInstancesCount ?? 0) },
      ]}
      backPath={`/account/${id}/resources/ecs_v1_Cluster`}
      tabs={[
        {
          label: 'Overview',
          content: (
            <Box sx={{ p: 1.5, overflow: 'auto' }}>
              <Stack spacing={1}>
                <MetadataSection data={cluster} />
                <DetailsCard
                  title='Cluster Info'
                  entries={[
                    { label: 'Name', value: cluster.ClusterName },
                    { label: 'Status', value: cluster.Status },
                    { label: 'ARN', value: cluster.ClusterArn },
                    { label: 'Active Services', value: cluster.ActiveServicesCount },
                    { label: 'Running Tasks', value: cluster.RunningTasksCount },
                    { label: 'Pending Tasks', value: cluster.PendingTasksCount },
                    { label: 'Container Instances', value: cluster.RegisteredContainerInstancesCount },
                  ]}
                />
                {cluster.Settings && (
                  <DetailsCard
                    title='Settings'
                    entries={(cluster.Settings || []).map((s: any) => ({
                      label: s.Name,
                      value: s.Value,
                    }))}
                  />
                )}
                <TagsSection data={cluster} />
              </Stack>
            </Box>
          ),
        },
        {
          label: 'Services',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='ecs::v1::Service'
              columns={ecsServiceColumns}
              idAccessor='ServiceName'
              filterFn={serviceFilter}
              drawer={serviceDrawer}
            />
          ),
        },
        {
          label: 'Tasks',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='ecs::v1::Task'
              columns={ecsTaskColumns}
              idAccessor='TaskArn'
              filterFn={taskFilter}
            />
          ),
        },
        {
          label: 'Container Instances',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='ecs::v1::ContainerInstance'
              columns={ecsContainerInstanceColumns}
              idAccessor='ContainerInstanceArn'
              filterFn={containerInstanceFilter}
            />
          ),
        },
        {
          label: 'Settings',
          content: (
            <Box sx={{ p: 1.5, overflow: 'auto' }}>
              <ClusterSettingsForm data={cluster} onSave={handleClusterSave} saving={clusterSaving} />
            </Box>
          ),
        },
      ]}
    />
  );
};

export default ECSClusterDetailPage;
