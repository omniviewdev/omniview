import React from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";
import { Card, Chip } from "@omniviewdev/ui";

type DetailEntry = {
  label: string;
  value: string | number | boolean | React.ReactNode | undefined | null;
  color?: "success" | "danger" | "warning" | "neutral" | "primary";
};

interface Props {
  title: string;
  icon?: React.ReactNode;
  entries: DetailEntry[];
}

const DetailRow: React.FC<{ entry: DetailEntry }> = ({ entry }) => {
  if (entry.value === undefined || entry.value === null || entry.value === "") return null;

  let rendered: React.ReactNode;
  if (typeof entry.value === "boolean") {
    rendered = (
      <Chip size="sm" label={entry.value ? "Yes" : "No"} color={entry.value ? "success" : "default"} variant="filled" sx={{ borderRadius: 1 }} />
    );
  } else if (entry.color) {
    const chipColor = entry.color === 'danger' ? 'error' : entry.color === 'neutral' ? 'default' : entry.color;
    rendered = (
      <Chip size="sm" label={String(entry.value)} color={chipColor} variant="filled" sx={{ borderRadius: 1 }} />
    );
  } else if (React.isValidElement(entry.value)) {
    rendered = entry.value;
  } else {
    rendered = (
      <Text size="xs" sx={{ fontWeight: 600, fontSize: 12, wordBreak: "break-all" }}>
        {String(entry.value)}
      </Text>
    );
  }

  return (
    <Grid container spacing={0}>
      <Grid size={4} sx={{ alignItems: "center" }}>
        <Text size="xs" sx={{ color: 'neutral.300' }}>
          {entry.label}
        </Text>
      </Grid>
      <Grid size={8} sx={{ alignItems: "center" }}>
        {rendered}
      </Grid>
    </Grid>
  );
};

const DetailsCard: React.FC<Props> = ({ title, icon, entries }) => {
  const visibleEntries = entries.filter(
    (e) => e.value !== undefined && e.value !== null && e.value !== ""
  );

  if (visibleEntries.length === 0) return null;

  return (
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
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Text weight="semibold" size="sm">{title}</Text>
        </Stack>
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
        {visibleEntries.map((entry, i) => (
          <DetailRow key={i} entry={entry} />
        ))}
      </Box>
    </Card>
  );
};

export type { DetailEntry };
export default DetailsCard;
