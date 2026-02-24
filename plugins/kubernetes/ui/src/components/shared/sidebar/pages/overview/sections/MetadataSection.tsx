import React from "react";

// @omniviewdev/ui
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Card, Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// types
import { ObjectMeta } from "kubernetes-types/meta/v1";

// third-party
import { formatRelative } from "date-fns";

// custom components
import KVCard from "../../../../KVCard";

interface Props {
  data?: ObjectMeta;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | React.ReactNode | undefined;
}> = ({ title, value }) => (
  <Grid container spacing={0}>
    <Grid size={3} sx={{ alignItems: "center" }}>
      <Text sx={{ color: "neutral.300" }} size="xs">
        {title}
      </Text>
    </Grid>
    <Grid size={9} sx={{ alignItems: "center" }}>
      {typeof value === 'string'
        ? <ClipboardText value={value} variant="inherit" sx={{ fontSize: 12, fontWeight: 600 }} />
        : value
      }
    </Grid>
  </Grid>
);

const MetadataSection: React.FC<Props> = ({ data }) => {
  if (!data) {
    return null;
  }

  return (
    <Stack direction="column" gap={0.5}>
      <Card
        sx={{
          p: 0,
          gap: 0,
          borderRadius: 1,
        }}
        variant="outlined"
      >
        <Box sx={{ py: 0.5, px: 1 }}>
          <Text weight="semibold" size="sm">Metadata</Text>
        </Box>
        <Divider />
        <Box
          sx={{
            py: 0.5,
            px: 1,
            backgroundColor: "background.level1",
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        >
          <ObjectMetaEntry title="Name" value={data.name} />
          {data.namespace && (
            <ObjectMetaEntry title="Namespace" value={data.namespace} />
          )}
          {data.creationTimestamp && <ObjectMetaEntry
            title="Created"
            value={formatRelative(new Date(data.creationTimestamp), new Date())}
          />}
          {data.deletionTimestamp && <ObjectMetaEntry
            title="Deletion"
            value={formatRelative(new Date(), new Date(data.deletionTimestamp))}
          />}
          {data.resourceVersion && <ObjectMetaEntry title="Version" value={data.resourceVersion} />}
          {/** TODO: change this to be a linkable chip instead of normal chip */}
          {!!data.ownerReferences?.length && <ObjectMetaEntry
            title={data.ownerReferences?.length > 1 ? "Owners" : "Owner"}
            value={
              <Stack direction='row'>
                {data.ownerReferences.map((ref) => (
                  <Chip
                    key={ref.uid}
                    size='sm'
                    emphasis='soft'
                    color='primary'
                    sx={{
                      borderRadius: 2,
                    }}
                    label={ref.kind}
                  />
                ))}
              </Stack>
            }
          />}
          {!!data.finalizers?.length && <ObjectMetaEntry
            title="Finalizers"
            value={
              <Stack direction='row'>
                {data.finalizers.map((finalizer) => (
                  <Chip
                    key={finalizer}
                    size='sm'
                    emphasis='soft'
                    color='primary'
                    sx={{
                      borderRadius: 2,
                    }}
                    label={finalizer}
                  />
                ))}
              </Stack>
            }
          />}
        </Box>
      </Card>
      {data.annotations && <KVCard title="Annotations" kvs={data.annotations} />}
      {data.labels && <KVCard title="Labels" kvs={data.labels} />}
    </Stack>
  );
};


export default MetadataSection;
