import React from "react";

// @omniviewdev/ui
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Card, ExpandableSections } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// types
import { ObjectMeta } from "kubernetes-types/meta/v1";

// third-party
import { formatRelative } from "date-fns";

interface Props {
  data?: ObjectMeta;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | undefined;
}> = ({ title, value }) => (
  <Grid container spacing={0}>
    <Grid size={3} sx={{ alignItems: "center" }}>
      <Text sx={{ color: "neutral.400" }} size="sm">
        {title}
      </Text>
    </Grid>
    <Grid size={9} sx={{ alignItems: "center" }}>
      <Text weight="semibold" size="sm" sx={{ color: "neutral.100" }}>
        {value}
      </Text>
    </Grid>
  </Grid>
);

const ObjectMetaSection: React.FC<Props> = ({ data }) => {
  if (!data) {
    return null;
  }

  const kvSections = [
    {
      title: 'Annotations',
      defaultExpanded: false,
      children: (
        <Grid container spacing={0.25}>
          {Object.entries(data.annotations || {}).map(([key, value]) => (
            <React.Fragment key={key}>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <Text sx={{ fontSize: 13, fontWeight: 400 }} size="sm">
                  {key}
                </Text>
              </Grid>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <Text sx={{ fontSize: 13, fontWeight: 600 }} size="sm">
                  {value}
                </Text>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      ),
    },
    {
      title: 'Labels',
      defaultExpanded: false,
      children: (
        <Grid container spacing={0.25}>
          {Object.entries(data.labels || {}).map(([key, value]) => (
            <React.Fragment key={key}>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <Text sx={{ fontSize: 13, fontWeight: 400 }} size="sm">
                  {key}
                </Text>
              </Grid>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <Text sx={{ fontSize: 13, fontWeight: 600 }} size="sm">
                  {value}
                </Text>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      ),
    },
  ];

  return (
    <Stack direction="column" gap={1}>
      <Card
        sx={{
          p: 0,
          gap: 0,
          borderRadius: "sm",
        }}
        variant="outlined"
      >
        <Box sx={{ py: 1, px: 1.25 }}>
          <Text weight="semibold" size="sm">Metadata</Text>
        </Box>
        <Divider />
        <Box
          sx={{
            p: 1,
            px: 1.5,
            backgroundColor: "background.level1",
            borderBottomRightRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        >
          <ObjectMetaEntry title="Name" value={data.name} />
          {data.namespace && (
            <ObjectMetaEntry title="Namespace" value={data.namespace} />
          )}
          <ObjectMetaEntry
            title="Created"
            value={
              data.creationTimestamp
                ? formatRelative(new Date(data.creationTimestamp), new Date())
                : undefined
            }
          />
          <ObjectMetaEntry title="Version" value={data.resourceVersion} />
        </Box>
      </Card>
      <ExpandableSections sections={kvSections} />
    </Stack>
  );
};

export default ObjectMetaSection;
