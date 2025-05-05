import React from "react";

// material-ui
import Grid from "@mui/joy/Grid";
import Typography from "@mui/joy/Typography";
import Accordion from "@mui/joy/Accordion";
import AccordionDetails from "@mui/joy/AccordionDetails";
import AccordionSummary from "@mui/joy/AccordionSummary";
import { Chip, Stack } from "@mui/joy";

interface Props {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
}

const KVCard: React.FC<Props> = ({ title, kvs, defaultExpanded }) => (
  <Accordion
    disabled={!Object.keys(kvs).length}
    defaultExpanded={defaultExpanded}
  >
    <AccordionSummary>
      <Stack direction={'row'} gap={1}>
        <Typography level="title-sm">{title}</Typography>
        <Chip
          size="sm"
          variant="outlined"
          color={'primary'}
          sx={{
            borderRadius: 'sm',
          }}
        >{Object.keys(kvs).length}</Chip>
      </Stack>
    </AccordionSummary>
    <AccordionDetails>
      <Grid container spacing={0.25}>
        {Object.entries(kvs).map(([key, value]) => (
          <>
            <Grid xs={6} alignItems={"center"}>
              <Typography fontSize={12} fontWeight={400} level="body-xs">
                {key}
              </Typography>
            </Grid>
            <Grid xs={6} alignItems={"center"}>
              <Typography fontSize={12} fontWeight={600} level="body-xs">
                {value}
              </Typography>
            </Grid>
          </>
        ))}
      </Grid>
    </AccordionDetails>
  </Accordion>
);

export default KVCard;
