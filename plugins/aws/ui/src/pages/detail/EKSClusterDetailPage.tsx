import React from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Chip } from '@omniviewdev/ui';
import { LuCode, LuContainer, LuPencil, LuSquareChartGantt } from 'react-icons/lu';
import { useResources, DrawerComponent } from '@omniviewdev/runtime';
import get from 'lodash.get';

import ResourceDetailPage from '../../components/shared/detail/ResourceDetailPage';
import FilteredResourceTable from '../../components/shared/table/FilteredResourceTable';
import DetailsCard from '../../components/shared/DetailsCard';
import ExpandableSection from '../../components/shared/ExpandableSection';
import MetadataSection from '../../components/shared/sidebar/pages/overview/sections/MetadataSection';
import NetworkingSection from '../../components/aws/sidebar/sections/NetworkingSection';
import TagsSection from '../../components/aws/sidebar/sections/TagsSection';
import BaseOverviewPage from '../../components/shared/sidebar/pages/overview/BaseOverviewPage';
import BaseEditorPage from '../../components/shared/sidebar/pages/editor/BaseEditorPage';
import NodegroupScalingForm from '../../components/aws/forms/eks/NodegroupScalingForm';
import useResourceForm from '../../components/shared/forms/useResourceForm';
import {
  eksNodegroupColumns,
  eksAddonColumns,
} from '../../components/aws/table/shared/childColumns';

const resourceKey = 'eks::v1::Cluster';
const idAccessor = 'Name';

const EKSClusterDetailPage: React.FC = () => {
  const { id = '', resourceId = '' } = useParams<{ id: string; resourceId: string }>();

  const { resources } = useResources({ pluginID: 'aws', connectionID: id, resourceKey, idAccessor });

  const cluster = React.useMemo(
    () => (resources.data?.result || []).find((item: any) => get(item, idAccessor) === resourceId),
    [resources.data?.result, resourceId],
  );

  if (resources.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (!cluster) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Text>Cluster not found: {resourceId}</Text>
      </Box>
    );
  }

  const clusterName = cluster.Name || '';
  const vpcConfig = cluster.ResourcesVpcConfig || {};

  const NodegroupEditView = React.useCallback((ctx: any) => {
    const { handleSave, saving } = useResourceForm({
      connectionID: ctx.resource?.connectionID || '',
      resourceKey: ctx.resource?.key || '',
      resourceID: ctx.resource?.id || '',
    });
    return <NodegroupScalingForm data={ctx.data || {}} onSave={handleSave} saving={saving} />;
  }, []);

  const nodegroupDrawer: DrawerComponent = React.useMemo(() => ({
    title: 'eks::v1::Nodegroup', icon: <LuContainer />,
    views: [
      { title: 'Overview', icon: <LuSquareChartGantt />, component: (ctx) => <BaseOverviewPage data={ctx.data || {}} /> },
      { title: 'Edit', icon: <LuPencil />, component: NodegroupEditView },
      { title: 'Editor', icon: <LuCode />, component: (ctx) => <BaseEditorPage data={ctx.data || {}} /> },
    ],
    actions: [],
  }), [NodegroupEditView]);

  const nodegroupFilter = React.useCallback(
    (item: any) => item.ClusterName === clusterName,
    [clusterName],
  );

  const addonFilter = React.useCallback(
    (item: any) => item.ClusterName === clusterName,
    [clusterName],
  );

  const statusColor = cluster.Status === 'ACTIVE' ? 'success' as const
    : (cluster.Status === 'CREATING' || cluster.Status === 'UPDATING') ? 'warning' as const
    : (cluster.Status === 'FAILED' || cluster.Status === 'DELETING') ? 'danger' as const
    : 'neutral' as const;

  const clusterLogging = cluster.Logging?.ClusterLogging;
  const hasLogging = Array.isArray(clusterLogging) && clusterLogging.length > 0;

  return (
    <ResourceDetailPage
      title={clusterName}
      subtitle={cluster.Arn}
      icon={<LuContainer />}
      status={cluster.Status}
      statusColor={statusColor}
      headerDetails={[
        { label: 'Version', value: cluster.Version || '' },
        { label: 'Platform', value: cluster.PlatformVersion || '' },
      ]}
      backPath={`/account/${id}/resources/eks_v1_Cluster`}
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
                    { label: 'Name', value: cluster.Name },
                    { label: 'Version', value: cluster.Version },
                    { label: 'Platform Version', value: cluster.PlatformVersion },
                    { label: 'Status', value: cluster.Status },
                    { label: 'Endpoint', value: cluster.Endpoint },
                    { label: 'Role ARN', value: cluster.RoleArn },
                    { label: 'Created At', value: cluster.CreatedAt ? String(cluster.CreatedAt) : undefined },
                    { label: 'OIDC Issuer', value: cluster.Identity?.Oidc?.Issuer },
                  ]}
                />
                <DetailsCard
                  title='Endpoint Access'
                  entries={[
                    { label: 'Public Access', value: vpcConfig.EndpointPublicAccess },
                    { label: 'Private Access', value: vpcConfig.EndpointPrivateAccess },
                    { label: 'Public CIDRs', value: Array.isArray(vpcConfig.PublicAccessCidrs) ? vpcConfig.PublicAccessCidrs.join(', ') : undefined },
                  ]}
                />
                {cluster.KubernetesNetworkConfig && (
                  <DetailsCard
                    title='Kubernetes Network'
                    entries={[
                      { label: 'Service CIDR', value: cluster.KubernetesNetworkConfig.ServiceIpv4Cidr },
                      { label: 'IP Family', value: cluster.KubernetesNetworkConfig.IpFamily },
                    ]}
                  />
                )}
                <NetworkingSection
                  vpcId={vpcConfig.VpcId}
                  subnetIds={vpcConfig.SubnetIds}
                  securityGroupIds={[
                    ...(vpcConfig.SecurityGroupIds || []),
                    ...(vpcConfig.ClusterSecurityGroupId ? [vpcConfig.ClusterSecurityGroupId] : []),
                  ]}
                />
                {hasLogging && (
                  <ExpandableSection
                    sections={[{
                      title: 'Logging',
                      defaultExpanded: false,
                      content: (
                        <Stack spacing={0.5}>
                          {clusterLogging.map((entry: { Types?: string[]; Enabled?: boolean }, i: number) => (
                            <Stack key={i} direction='row' spacing={1} alignItems='center'>
                              <Text size="xs" sx={{ fontFamily: 'monospace' }}>
                                {Array.isArray(entry.Types) ? entry.Types.join(', ') : 'Unknown'}
                              </Text>
                              <Chip size='sm' label={entry.Enabled ? 'Enabled' : 'Disabled'} color={entry.Enabled ? 'success' : 'default'} variant='filled' sx={{ borderRadius: 'sm' }} />
                            </Stack>
                          ))}
                        </Stack>
                      ),
                    }]}
                  />
                )}
                <TagsSection data={cluster} />
              </Stack>
            </Box>
          ),
        },
        {
          label: 'Nodegroups',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='eks::v1::Nodegroup'
              columns={eksNodegroupColumns}
              idAccessor='NodegroupName'
              filterFn={nodegroupFilter}
              drawer={nodegroupDrawer}
            />
          ),
        },
        {
          label: 'Addons',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='eks::v1::Addon'
              columns={eksAddonColumns}
              idAccessor='AddonName'
              filterFn={addonFilter}
            />
          ),
        },
      ]}
    />
  );
};

export default EKSClusterDetailPage;
