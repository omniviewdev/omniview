import React from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuScale } from 'react-icons/lu';
import { useResources } from '@omniviewdev/runtime';
import get from 'lodash.get';

import ResourceDetailPage from '../../components/shared/detail/ResourceDetailPage';
import FilteredResourceTable from '../../components/shared/table/FilteredResourceTable';
import DetailsCard from '../../components/shared/DetailsCard';
import MetadataSection from '../../components/shared/sidebar/pages/overview/sections/MetadataSection';
import NetworkingSection from '../../components/aws/sidebar/sections/NetworkingSection';
import TagsSection from '../../components/aws/sidebar/sections/TagsSection';
import {
  elbListenerColumns,
  elbTargetGroupColumns,
} from '../../components/aws/table/shared/childColumns';

const resourceKey = 'elbv2::v1::LoadBalancer';
const idAccessor = 'LoadBalancerArn';

const ELBLoadBalancerDetailPage: React.FC = () => {
  const { id = '', resourceId = '' } = useParams<{ id: string; resourceId: string }>();

  const { resources } = useResources({ pluginID: 'aws', connectionID: id, resourceKey, idAccessor });

  const lb = React.useMemo(
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

  if (!lb) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Text>Load Balancer not found</Text>
      </Box>
    );
  }

  const lbArn = lb.LoadBalancerArn || '';

  const listenerFilter = React.useCallback(
    (item: any) => item.LoadBalancerArn === lbArn,
    [lbArn],
  );

  const targetGroupFilter = React.useCallback(
    (item: any) => Array.isArray(item.LoadBalancerArns) && item.LoadBalancerArns.includes(lbArn),
    [lbArn],
  );

  const stateCode = lb.State?.Code;
  const statusColor = stateCode === 'active' ? 'success' as const
    : stateCode === 'provisioning' ? 'warning' as const
    : (stateCode === 'failed' || stateCode === 'active_impaired') ? 'danger' as const
    : 'neutral' as const;

  const azs: string[] = Array.isArray(lb.AvailabilityZones)
    ? lb.AvailabilityZones.map((az: any) => az.ZoneName).filter((z: string | undefined): z is string => !!z)
    : [];

  return (
    <ResourceDetailPage
      title={lb.LoadBalancerName || ''}
      subtitle={lb.LoadBalancerArn}
      icon={<LuScale />}
      status={stateCode}
      statusColor={statusColor}
      headerDetails={[
        { label: 'Type', value: lb.Type || '' },
        { label: 'Scheme', value: lb.Scheme || '' },
      ]}
      backPath={`/account/${id}/resources/elbv2_v1_LoadBalancer`}
      tabs={[
        {
          label: 'Overview',
          content: (
            <Box sx={{ p: 1.5, overflow: 'auto' }}>
              <Stack spacing={1}>
                <MetadataSection data={lb} />
                <DetailsCard
                  title='Load Balancer Info'
                  entries={[
                    { label: 'Name', value: lb.LoadBalancerName },
                    { label: 'Type', value: lb.Type },
                    { label: 'Scheme', value: lb.Scheme },
                    { label: 'DNS Name', value: lb.DNSName },
                    { label: 'State', value: stateCode },
                    { label: 'IP Address Type', value: lb.IpAddressType },
                    { label: 'ARN', value: lb.LoadBalancerArn },
                    { label: 'Created', value: lb.CreatedTime ? String(lb.CreatedTime) : undefined },
                    { label: 'Hosted Zone', value: lb.CanonicalHostedZoneId },
                  ]}
                />
                <NetworkingSection
                  vpcId={lb.VpcId}
                  availabilityZones={azs}
                  securityGroupIds={Array.isArray(lb.SecurityGroups) ? lb.SecurityGroups : []}
                />
                <TagsSection data={lb} />
              </Stack>
            </Box>
          ),
        },
        {
          label: 'Listeners',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='elbv2::v1::Listener'
              columns={elbListenerColumns}
              idAccessor='ListenerArn'
              filterFn={listenerFilter}
            />
          ),
        },
        {
          label: 'Target Groups',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='elbv2::v1::TargetGroup'
              columns={elbTargetGroupColumns}
              idAccessor='TargetGroupArn'
              filterFn={targetGroupFilter}
            />
          ),
        },
      ]}
    />
  );
};

export default ELBLoadBalancerDetailPage;
