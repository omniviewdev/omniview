import React from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import { Card, Chip } from "@omniviewdev/ui";
import KVCard from "../../../../../shared/KVCard";

interface Props {
  data?: Record<string, any>;
}

const MetaEntry: React.FC<{
  title: string;
  value: string | React.ReactNode | undefined;
}> = ({ title, value }) => {
  if (!value) return null;
  return (
    <Grid container spacing={0}>
      <Grid size={3} sx={{ alignItems: "center" }}>
        <Text size="xs" sx={{ color: "neutral.300" }}>
          {title}
        </Text>
      </Grid>
      <Grid size={9} sx={{ alignItems: "center" }}>
        {typeof value === 'string'
          ? <Text size="xs" sx={{ fontWeight: 600, fontSize: 12 }}>
            {value}
          </Text>
          : value
        }
      </Grid>
    </Grid>
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
    <Stack direction="column" spacing={1}>
      <Card
        sx={{
          "--Card-padding": "0px",
          "--Card-gap": "0px",
          borderRadius: 1,
          gap: "0px",
        }}
        variant="outlined"
      >
        <Box sx={{ py: 1, px: 1.25 }}>
          <Text weight="semibold" size="sm">Resource Info</Text>
        </Box>
        <Divider />
        <Box
          sx={{
            p: 1,
            px: 1.5,
            backgroundColor: "background.paper",
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        >
          <MetaEntry title="Name" value={name} />
          {region && <MetaEntry title="Region" value={region} />}
          {arn && <MetaEntry title="ARN" value={
            <Text size="xs" sx={{ fontWeight: 600, fontSize: 11, wordBreak: 'break-all' }}>
              {arn}
            </Text>
          } />}
          {data.State?.Name && <MetaEntry title="State" value={
            <Chip size='sm' label={data.State.Name} color={
              data.State.Name === 'running' ? 'success' :
              data.State.Name === 'stopped' ? 'error' : 'warning'
            } variant='filled' sx={{ borderRadius: 2 }} />
          } />}
          {data.Status && typeof data.Status === 'string' && <MetaEntry title="Status" value={
            <Chip size='sm' label={data.Status} color={
              data.Status === 'available' || data.Status === 'ACTIVE' || data.Status === 'Active' ? 'success' :
              data.Status === 'deleting' || data.Status === 'failed' ? 'error' : 'warning'
            } variant='filled' sx={{ borderRadius: 2 }} />
          } />}
        </Box>
      </Card>
      {Object.keys(tags).length > 0 && (
        <KVCard title="Tags" kvs={tags} defaultExpanded />
      )}
    </Stack>
  );
};

export default MetadataSection;
