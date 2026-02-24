import React from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuNetwork } from 'react-icons/lu';
import { useResources } from '@omniviewdev/runtime';
import get from 'lodash.get';

import ResourceDetailPage from '../../components/shared/detail/ResourceDetailPage';
import FilteredResourceTable from '../../components/shared/table/FilteredResourceTable';
import DetailsCard from '../../components/shared/DetailsCard';
import ExpandableSection from '../../components/shared/ExpandableSection';
import MetadataSection from '../../components/shared/sidebar/pages/overview/sections/MetadataSection';
import TagsSection from '../../components/aws/sidebar/sections/TagsSection';
import {
  vpcSubnetColumns,
  vpcRouteTableColumns,
  vpcSecurityGroupColumns,
  vpcInternetGatewayColumns,
  vpcNATGatewayColumns,
} from '../../components/aws/table/shared/childColumns';

const resourceKey = 'vpc::v1::VPC';
const idAccessor = 'VpcId';

const VPCDetailPage: React.FC = () => {
  const { id = '', resourceId = '' } = useParams<{ id: string; resourceId: string }>();

  const { resources } = useResources({ pluginID: 'aws', connectionID: id, resourceKey, idAccessor });

  const vpc = React.useMemo(
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

  if (!vpc) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Text>VPC not found: {resourceId}</Text>
      </Box>
    );
  }

  const vpcId = vpc.VpcId || '';

  const subnetFilter = React.useCallback(
    (item: any) => item.VpcId === vpcId,
    [vpcId],
  );

  const routeTableFilter = React.useCallback(
    (item: any) => item.VpcId === vpcId,
    [vpcId],
  );

  const securityGroupFilter = React.useCallback(
    (item: any) => item.VpcId === vpcId,
    [vpcId],
  );

  const igwFilter = React.useCallback(
    (item: any) => (item.Attachments || []).some((a: any) => a.VpcId === vpcId),
    [vpcId],
  );

  const natFilter = React.useCallback(
    (item: any) => item.VpcId === vpcId,
    [vpcId],
  );

  const statusColor = vpc.State === 'available' ? 'success' as const : 'warning' as const;

  const ipv6Associations: Array<Record<string, any>> = Array.isArray(vpc.Ipv6CidrBlockAssociationSet)
    ? vpc.Ipv6CidrBlockAssociationSet : [];
  const cidrAssociations: Array<Record<string, any>> = Array.isArray(vpc.CidrBlockAssociationSet)
    ? vpc.CidrBlockAssociationSet : [];

  return (
    <ResourceDetailPage
      title={vpc._Name || vpc.VpcId}
      subtitle={vpc.VpcId}
      icon={<LuNetwork />}
      status={vpc.State}
      statusColor={statusColor}
      headerDetails={[
        { label: 'CIDR', value: vpc.CidrBlock || '' },
        { label: 'Default', value: vpc.IsDefault ? 'Yes' : 'No' },
      ]}
      backPath={`/account/${id}/resources/vpc_v1_VPC`}
      tabs={[
        {
          label: 'Overview',
          content: (
            <Box sx={{ p: 1.5, overflow: 'auto' }}>
              <Stack spacing={1}>
                <MetadataSection data={vpc} />
                <DetailsCard
                  title='VPC Details'
                  entries={[
                    { label: 'VPC ID', value: vpc.VpcId },
                    { label: 'CIDR Block', value: vpc.CidrBlock },
                    { label: 'State', value: vpc.State },
                    { label: 'Default', value: vpc.IsDefault },
                    { label: 'Tenancy', value: vpc.InstanceTenancy },
                    { label: 'DHCP Options ID', value: vpc.DhcpOptionsId },
                    { label: 'Owner ID', value: vpc.OwnerId },
                  ]}
                />
                {ipv6Associations.length > 0 && (
                  <DetailsCard
                    title='IPv6'
                    entries={ipv6Associations.map((assoc, i) => ({
                      label: `CIDR ${i + 1}`,
                      value: assoc.Ipv6CidrBlock
                        ? `${assoc.Ipv6CidrBlock} (${assoc.Ipv6CidrBlockState?.State || 'unknown'})`
                        : undefined,
                    }))}
                  />
                )}
                {cidrAssociations.length > 1 && (
                  <ExpandableSection
                    sections={[{
                      title: 'CIDR Blocks',
                      count: cidrAssociations.length,
                      defaultExpanded: false,
                      content: (
                        <Stack spacing={0.5}>
                          {cidrAssociations.map((assoc, i) => (
                            <Text key={i} size="sm">
                              {assoc.CidrBlock || '\u2014'}{' '}
                              ({assoc.CidrBlockState?.State || 'unknown'})
                            </Text>
                          ))}
                        </Stack>
                      ),
                    }]}
                  />
                )}
                <TagsSection data={vpc} />
              </Stack>
            </Box>
          ),
        },
        {
          label: 'Subnets',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='vpc::v1::Subnet'
              columns={vpcSubnetColumns}
              idAccessor='SubnetId'
              filterFn={subnetFilter}
            />
          ),
        },
        {
          label: 'Route Tables',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='vpc::v1::RouteTable'
              columns={vpcRouteTableColumns}
              idAccessor='RouteTableId'
              filterFn={routeTableFilter}
            />
          ),
        },
        {
          label: 'Security Groups',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='vpc::v1::SecurityGroup'
              columns={vpcSecurityGroupColumns}
              idAccessor='GroupId'
              filterFn={securityGroupFilter}
            />
          ),
        },
        {
          label: 'Internet Gateways',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='vpc::v1::InternetGateway'
              columns={vpcInternetGatewayColumns}
              idAccessor='InternetGatewayId'
              filterFn={igwFilter}
            />
          ),
        },
        {
          label: 'NAT Gateways',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='vpc::v1::NATGateway'
              columns={vpcNATGatewayColumns}
              idAccessor='NatGatewayId'
              filterFn={natFilter}
            />
          ),
        },
      ]}
    />
  );
};

export default VPCDetailPage;
