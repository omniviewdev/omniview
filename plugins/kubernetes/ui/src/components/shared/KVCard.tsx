import React from "react";

// @omniviewdev/ui
import Grid from "@mui/material/Grid";
import { Chip, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import ExpandableSections from './ExpandableSections';

interface Props {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
  size?: "sm" | "md" | "lg";
}

const KVCard: React.FC<Props> = ({ title, kvs, defaultExpanded, size = "sm" }) => {
  const sections = [
    {
      title: (
        <Stack direction='row' gap={0.75} alignItems="center">
          <Text weight='semibold' size='xs' sx={{ fontSize: 12 }}>{title}</Text>
          <Chip
            size="xs"
            emphasis="outline"
            color='primary'
            sx={{ borderRadius: 1 }}
            label={String(Object.keys(kvs).length)}
          />
        </Stack>
      ),
      defaultExpanded: defaultExpanded && Object.keys(kvs).length > 0,
      children: (
        <Grid container spacing={0.25} sx={{ px: 1, py: 0.5 }}>
          {Object.entries(kvs).map(([key, value]) => (
            <React.Fragment key={key}>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <ClipboardText value={key} variant="inherit" sx={{ fontSize: 11, fontWeight: 400 }} />
              </Grid>
              <Grid size={6} sx={{ alignItems: "center" }}>
                <ClipboardText value={value} variant="inherit" sx={{ fontSize: 11, fontWeight: 600 }} />
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      ),
    },
  ];

  return (
    <ExpandableSections sections={sections} size={size} />
  );
};

export default KVCard;
