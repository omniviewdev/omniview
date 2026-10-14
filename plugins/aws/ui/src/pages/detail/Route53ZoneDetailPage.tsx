import React from 'react';
import { Spinner, Stack, Text } from '@omniviewdev/base-ui';
import { useParams } from 'react-router-dom';
import { LuGlobe } from 'react-icons/lu';
import { useResources } from '@omniviewdev/runtime';
import get from 'lodash.get';

import ResourceDetailPage from '../../components/shared/detail/ResourceDetailPage';
import FilteredResourceTable from '../../components/shared/table/FilteredResourceTable';
import DetailsCard from '../../components/shared/DetailsCard';
import MetadataSection from '../../components/shared/sidebar/pages/overview/sections/MetadataSection';
import TagsSection from '../../components/aws/sidebar/sections/TagsSection';
import {
  route53RecordSetColumns,
  route53HealthCheckColumns,
} from '../../components/aws/table/shared/childColumns';

const resourceKey = 'route53::v1::HostedZone';
const idAccessor = '_CleanId';

const Route53ZoneDetailPage: React.FC = () => {
  const { id = '', resourceId = '' } = useParams<{ id: string; resourceId: string }>();

  const { resources } = useResources({ pluginID: 'aws', connectionID: id, resourceKey, idAccessor });

  const zone = React.useMemo(
    () => (resources.data?.result || []).find((item: any) => get(item, idAccessor) === resourceId),
    [resources.data?.result, resourceId],
  );

  if (resources.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spinner size='lg' />
      </div>
    );
  }

  if (!zone) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Text>Hosted Zone not found: {resourceId}</Text>
      </div>
    );
  }

  const zoneId = zone.Id || zone._CleanId || '';
  const cleanZoneId = zone._CleanId || zoneId.replace('/hostedzone/', '');
  const isPrivate = zone.Config?.PrivateZone;

  const recordSetFilter = React.useCallback(
    (item: any) => {
      const itemZoneId = item.HostedZoneId || item._HostedZoneId || '';
      return itemZoneId === cleanZoneId || itemZoneId === zoneId;
    },
    [cleanZoneId, zoneId],
  );

  const nameservers = zone.DelegationSet?.NameServers || [];

  return (
    <ResourceDetailPage
      title={zone._Name || zone.Name || cleanZoneId}
      subtitle={zoneId}
      icon={<LuGlobe />}
      status={isPrivate ? 'Private' : 'Public'}
      statusColor={isPrivate ? 'warning' : 'success'}
      headerDetails={[
        { label: 'Records', value: String(zone.ResourceRecordSetCount ?? 0) },
      ]}
      backPath={`/account/${id}/resources/route53_v1_HostedZone`}
      tabs={[
        {
          label: 'Overview',
          content: (
            <div style={{ padding: 12, overflow: 'auto' }}>
              <Stack spacing={2}>
                <MetadataSection data={zone} />
                <DetailsCard
                  title='Zone Info'
                  entries={[
                    { label: 'Name', value: zone._Name || zone.Name },
                    { label: 'Zone ID', value: cleanZoneId },
                    { label: 'Type', value: isPrivate ? 'Private' : 'Public' },
                    { label: 'Record Count', value: zone.ResourceRecordSetCount },
                    { label: 'Comment', value: zone.Config?.Comment },
                  ]}
                />
                {nameservers.length > 0 && (
                  <DetailsCard
                    title='Name Servers'
                    entries={nameservers.map((ns: string, i: number) => ({
                      label: `NS ${i + 1}`,
                      value: ns,
                    }))}
                  />
                )}
                <TagsSection data={zone} />
              </Stack>
            </div>
          ),
        },
        {
          label: 'Record Sets',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='route53::v1::RecordSet'
              columns={route53RecordSetColumns}
              idAccessor='Name'
              filterFn={recordSetFilter}
            />
          ),
        },
        {
          label: 'Health Checks',
          content: (
            <FilteredResourceTable
              connectionID={id}
              resourceKey='route53::v1::HealthCheck'
              columns={route53HealthCheckColumns}
              idAccessor='Id'
              filterFn={() => true}
            />
          ),
        },
      ]}
    />
  );
};

export default Route53ZoneDetailPage;
