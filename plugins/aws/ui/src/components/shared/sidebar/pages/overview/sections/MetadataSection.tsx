import React from "react";
import {
  AccordionGroup,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
  accordionDetailsClasses,
  accordionSummaryClasses,
} from '@mui/joy';
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
      <Grid xs={3} alignItems={"center"}>
        <Typography textColor={"neutral.300"} level="body-xs">
          {title}
        </Typography>
      </Grid>
      <Grid xs={9} alignItems={"center"}>
        {typeof value === 'string'
          ? <Typography fontWeight={600} fontSize={12} level="body-xs">
            {value}
          </Typography>
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
          borderRadius: "sm",
          gap: "0px",
        }}
        variant="outlined"
      >
        <Box sx={{ py: 1, px: 1.25 }}>
          <Typography level="title-sm">Resource Info</Typography>
        </Box>
        <Divider />
        <CardContent
          sx={{
            p: 1,
            px: 1.5,
            backgroundColor: "background.level1",
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        >
          <MetaEntry title="Name" value={name} />
          {region && <MetaEntry title="Region" value={region} />}
          {arn && <MetaEntry title="ARN" value={
            <Typography fontWeight={600} fontSize={11} level="body-xs" sx={{ wordBreak: 'break-all' }}>
              {arn}
            </Typography>
          } />}
          {data.State?.Name && <MetaEntry title="State" value={
            <Chip size='sm' variant='soft' color={
              data.State.Name === 'running' ? 'success' :
              data.State.Name === 'stopped' ? 'danger' : 'warning'
            } sx={{ borderRadius: 2 }}>
              {data.State.Name}
            </Chip>
          } />}
          {data.Status && typeof data.Status === 'string' && <MetaEntry title="Status" value={
            <Chip size='sm' variant='soft' color={
              data.Status === 'available' || data.Status === 'ACTIVE' || data.Status === 'Active' ? 'success' :
              data.Status === 'deleting' || data.Status === 'failed' ? 'danger' : 'warning'
            } sx={{ borderRadius: 2 }}>
              {data.Status}
            </Chip>
          } />}
        </CardContent>
      </Card>
      {Object.keys(tags).length > 0 && (
        <AccordionGroup
          variant="outlined"
          transition="0.2s"
          size="sm"
          sx={{
            borderRadius: "sm",
            [`& .${accordionSummaryClasses.button}:hover`]: { bgcolor: "transparent" },
            [`& .${accordionDetailsClasses.content}`]: {
              backgroundColor: "background.level1",
              boxShadow: (theme) => `inset 0 1px ${theme.vars.palette.divider}`,
              [`&.${accordionDetailsClasses.expanded}`]: { paddingBlock: "0.75rem" },
            },
          }}
        >
          <KVCard title="Tags" kvs={tags} defaultExpanded />
        </AccordionGroup>
      )}
    </Stack>
  );
};

export default MetadataSection;
