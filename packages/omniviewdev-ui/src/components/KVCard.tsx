import React from "react";

import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface KVCardProps {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
}

/**
 * An accordion card for displaying key-value pairs.
 */
const KVCard: React.FC<KVCardProps> = ({ title, kvs, defaultExpanded }) => (
  <Accordion
    disabled={!Object.keys(kvs).length}
    defaultExpanded={defaultExpanded}
    disableGutters
    sx={{ "&:before": { display: "none" } }}
  >
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Stack direction="row" gap={1} alignItems="center">
        <Typography variant="subtitle2">{title}</Typography>
        <Chip
          size="small"
          variant="outlined"
          color="primary"
          label={Object.keys(kvs).length}
          sx={{ borderRadius: "4px" }}
        />
      </Stack>
    </AccordionSummary>
    <AccordionDetails>
      <Grid container spacing={0.25}>
        {Object.entries(kvs).map(([key, value]) => (
          <React.Fragment key={key}>
            <Grid size={6}>
              <Typography variant="caption" sx={{ fontWeight: 400 }}>
                {key}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {value}
              </Typography>
            </Grid>
          </React.Fragment>
        ))}
      </Grid>
    </AccordionDetails>
  </Accordion>
);

KVCard.displayName = "KVCard";

export { type KVCardProps };
export default KVCard;
