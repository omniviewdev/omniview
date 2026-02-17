import React from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from "@mui/joy";

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
      <Chip size="sm" variant="soft" color={entry.value ? "success" : "neutral"} sx={{ borderRadius: "sm" }}>
        {entry.value ? "Yes" : "No"}
      </Chip>
    );
  } else if (entry.color) {
    rendered = (
      <Chip size="sm" variant="soft" color={entry.color} sx={{ borderRadius: "sm" }}>
        {String(entry.value)}
      </Chip>
    );
  } else if (React.isValidElement(entry.value)) {
    rendered = entry.value;
  } else {
    rendered = (
      <Typography fontWeight={600} fontSize={12} level="body-xs" sx={{ wordBreak: "break-all" }}>
        {String(entry.value)}
      </Typography>
    );
  }

  return (
    <Grid container spacing={0}>
      <Grid xs={4} alignItems="center">
        <Typography textColor="neutral.300" level="body-xs">
          {entry.label}
        </Typography>
      </Grid>
      <Grid xs={8} alignItems="center">
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
        borderRadius: "sm",
        gap: "0px",
      }}
      variant="outlined"
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography level="title-sm">{title}</Typography>
        </Stack>
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
        {visibleEntries.map((entry, i) => (
          <DetailRow key={i} entry={entry} />
        ))}
      </CardContent>
    </Card>
  );
};

export type { DetailEntry };
export default DetailsCard;
