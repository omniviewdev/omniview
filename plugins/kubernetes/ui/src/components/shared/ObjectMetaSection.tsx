import React from "react";

// material-ui
import Card from "@mui/joy/Card";
import Grid from "@mui/joy/Grid";
import Stack from "@mui/joy/Stack";
import Typography from "@mui/joy/Typography";
import AccordionGroup from "@mui/joy/AccordionGroup";
import Accordion from "@mui/joy/Accordion";
import AccordionDetails, {
  accordionDetailsClasses,
} from "@mui/joy/AccordionDetails";
import AccordionSummary, {
  accordionSummaryClasses,
} from "@mui/joy/AccordionSummary";

// types
import { ObjectMeta } from "kubernetes-types/meta/v1";
import { Box, CardContent, Divider } from "@mui/joy";

interface Props {
  data?: ObjectMeta;
}

const ObjectMetaEntry: React.FC<{
  title: string;
  value: string | undefined;
}> = ({ title, value }) => (
  <Grid container spacing={0}>
    <Grid xs={3} alignItems={"center"}>
      <Typography textColor={"neutral.400"} level="body-sm">
        {title}
      </Typography>
    </Grid>
    <Grid xs={9} alignItems={"center"}>
      <Typography fontWeight={400} textColor={"neutral.100"} level="title-sm">
        {value}
      </Typography>
    </Grid>
  </Grid>
);

const ObjectMetaSection: React.FC<Props> = ({ data }) => {
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
        <Box sx={{ py: 1, px: 1.5 }}>
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
          <ObjectMetaEntry title="Created" value={data.creationTimestamp} />
          <ObjectMetaEntry title="Version" value={data.resourceVersion} />
        </CardContent>
      </Card>
      <AccordionGroup
        variant="outlined"
        transition="0.2s"
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
        <KVCard title="Annotations" kvs={data.annotations || {}} />
        <KVCard title="Labels" kvs={data.labels || {}} />
      </AccordionGroup>
    </Stack>
  );
};

interface KVCardProps {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
}

const KVCard: React.FC<KVCardProps> = ({ title, kvs, defaultExpanded }) => (
  <Accordion defaultExpanded={defaultExpanded}>
    <AccordionSummary>
      <Typography level="title-sm">{title}</Typography>
    </AccordionSummary>
    <AccordionDetails>
      <Grid container spacing={0.25}>
        {Object.entries(kvs).map(([key, value]) => (
          <>
            <Grid xs={6} alignItems={"center"}>
              <Typography fontSize={13} fontWeight={400} level="body-sm">
                {key}
              </Typography>
            </Grid>
            <Grid xs={6} alignItems={"center"}>
              <Typography fontSize={13} fontWeight={600} level="body-sm">
                {value}
              </Typography>
            </Grid>
          </>
        ))}
      </Grid>
    </AccordionDetails>
  </Accordion>
);

export default ObjectMetaSection;
