import React from "react";
import { Chip, Stack } from "@omniviewdev/base-ui";
import KVCard from "../../../../../shared/KVCard";
import SectionCard from "../../../../ui/SectionCard";
import LabeledRow, { ValueText } from "../../../../ui/LabeledRow";

interface Props {
  data?: Record<string, any>;
}

const MetaEntry: React.FC<{
  title: string;
  value: string | React.ReactNode | undefined;
}> = ({ title, value }) => {
  if (!value) return null;
  return (
    <LabeledRow label={title} labelSpan={3}>
      {typeof value === 'string'
        ? <ValueText>{value}</ValueText>
        : value
      }
    </LabeledRow>
  );
};

const MetadataSection: React.FC<Props> = ({ data }) => {
  if (!data) return null;

  // Extract common AWS resource fields
  const name = data._Name || data.Name || data.FunctionName || data.DBInstanceIdentifier
    || data.BucketName || data.RoleName || data.UserName || data.TableName
    || data.AlarmName || data.ClusterName || data.LoadBalancerName || '';
  const region = data.Region || data._Region || '';
  const arn = data.Arn || data.ARN || data.FunctionArn || data.DBInstanceArn
    || data.RoleArn || data.PolicyArn || data.LoadBalancerArn
    || data.ClusterArn || data.TopicArn || data.QueueArn || '';

  // Extract tags - AWS resources may have tags as array of {Key, Value} or as a flat map
  const tags: Record<string, string> = {};
  if (data.Tags) {
    if (Array.isArray(data.Tags)) {
      data.Tags.forEach((tag: { Key?: string; Value?: string }) => {
        if (tag.Key) tags[tag.Key] = tag.Value || '';
      });
    } else if (typeof data.Tags === 'object') {
      Object.entries(data.Tags).forEach(([k, v]) => {
        tags[k] = String(v);
      });
    }
  }

  return (
    <Stack direction="column" spacing={2}>
      <SectionCard title="Resource Info">
          <MetaEntry title="Name" value={name} />
          {region && <MetaEntry title="Region" value={region} />}
          {arn && <MetaEntry title="ARN" value={
            <ValueText fontSize={11}>
              {arn}
            </ValueText>
          } />}
          {data.State?.Name && <MetaEntry title="State" value={
            <Chip size='sm' color={
              data.State.Name === 'running' ? 'success' :
              data.State.Name === 'stopped' ? 'danger' : 'warning'
            } variant='solid' style={{ borderRadius: 8 }}>{data.State.Name}</Chip>
          } />}
          {data.Status && typeof data.Status === 'string' && <MetaEntry title="Status" value={
            <Chip size='sm' color={
              data.Status === 'available' || data.Status === 'ACTIVE' || data.Status === 'Active' ? 'success' :
              data.Status === 'deleting' || data.Status === 'failed' ? 'danger' : 'warning'
            } variant='solid' style={{ borderRadius: 8 }}>{data.Status}</Chip>
          } />}
      </SectionCard>
      {Object.keys(tags).length > 0 && (
        <KVCard title="Tags" kvs={tags} defaultExpanded />
      )}
    </Stack>
  );
};

export default MetadataSection;
