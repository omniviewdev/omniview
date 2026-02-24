import React from "react";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

import type { RuntimeClass } from "kubernetes-types/node/v1";

interface Props {
  data: RuntimeClass;
}

const InfoEntry: React.FC<{ label: string; value?: string }> = ({
  label,
  value,
}) => {
  if (!value) return null;
  return (
    <Grid container spacing={0} sx={{ minHeight: 22, alignItems: "center" }}>
      <Grid size={4}>
        <Text sx={{ color: "neutral.300" }} size="xs">
          {label}
        </Text>
      </Grid>
      <Grid size={8}>
        <Text sx={{ fontWeight: 600, fontSize: 12 }} size="xs" noWrap>
          {value}
        </Text>
      </Grid>
    </Grid>
  );
};

const RuntimeClassHandlerSection: React.FC<Props> = ({ data }) => {
  const overhead = data.overhead?.podFixed;

  return (
    <Box sx={{ borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
      <Box sx={{ py: 0.5, px: 1 }}>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text weight="semibold" size="sm">
            Runtime
          </Text>
          <Chip size="sm" variant="outlined">
            {data.handler ?? "—"}
          </Chip>
        </Stack>
      </Box>
      {overhead && Object.keys(overhead).length > 0 && (
        <>
          <Divider />
          <Box sx={{ py: 0.5, px: 1, bgcolor: "background.level1" }}>
            <InfoEntry label="CPU Overhead" value={overhead.cpu} />
            <InfoEntry label="Memory Overhead" value={overhead.memory} />
          </Box>
        </>
      )}
    </Box>
  );
};

export default RuntimeClassHandlerSection;
