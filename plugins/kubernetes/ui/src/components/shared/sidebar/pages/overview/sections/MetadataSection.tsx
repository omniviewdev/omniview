import React from "react";

// material-ui
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

const MetadataSection: React.FC<Props> = ({ data }) => {
  if (!data) {
    return null;
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
          <Typography level="title-sm">Metadata</Typography>
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
              <Stack direction={'row'}>
                {data.ownerReferences.map((ref) => (
                  <Chip
                    size='sm'
                    variant='soft'
                    color={'primary'}
                    sx={{
                      borderRadius: 2,
                    }}
                  >
                    {ref.kind}
                  </Chip>
                ))}
              </Stack>
            }
          />}
          {!!data.finalizers?.length && <ObjectMetaEntry
            title="Finalizers"
            value={
              <Stack direction={'row'}>
                {data.finalizers.map((finalizer) => (
                  <Chip
                    size='sm'
                    variant='soft'
                    color={'primary'}
                    sx={{
                      borderRadius: 2,
                    }}
                  >
                    {finalizer}
                  </Chip>
                ))}
              </Stack>
            }
          />}
        </CardContent>
      </Card>
      <AccordionGroup
        variant="outlined"
        transition="0.2s"
        size="sm"
        sx={{
          borderRadius: "sm",
          [`& .${accordionSummaryClasses.button}:hover`]: {
            bgcolor: "transparent",
          },
          [`& .${accordionDetailsClasses.content}`]: {
            backgroundColor: "background.level1",
            boxShadow: (theme) => `inset 0 1px ${theme.vars.palette.divider}`,
            [`&.${accordionDetailsClasses.expanded}`]: {
              paddingBlock: "0.75rem",
            },
          },
        }}
      >
        {data.annotations && <KVCard title="Annotations" kvs={data.annotations} />}
        {data.labels && <KVCard title="Labels" kvs={data.labels} />}
      </AccordionGroup>
    </Stack>
  );
};


export default MetadataSection;
