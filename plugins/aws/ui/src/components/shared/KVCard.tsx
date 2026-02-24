import React, { useState } from "react";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { Text } from "@omniviewdev/ui/typography";
import { Stack } from "@omniviewdev/ui/layout";
import { Chip } from "@omniviewdev/ui";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";

interface Props {
  title: string;
  kvs: Record<string, string>;
  defaultExpanded?: boolean;
}

const KVCard: React.FC<Props> = ({ title, kvs, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const disabled = !Object.keys(kvs).length;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Box
        onClick={() => !disabled && setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: 1.5,
          py: 0.75,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          '&:hover': disabled ? {} : { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
          {expanded ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Text weight="semibold" size="sm">{title}</Text>
          <Chip
            size="sm"
            variant="outlined"
            color="primary"
            label={Object.keys(kvs).length}
            sx={{ borderRadius: 1 }}
          />
        </Stack>
      </Box>
      {expanded && (
        <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Grid container spacing={0.25}>
            {Object.entries(kvs).map(([key, value]) => (
              <React.Fragment key={key}>
                <Grid size={6} sx={{ alignItems: "center" }}>
                  <Text size="xs" sx={{ fontSize: 12, fontWeight: 400 }}>
                    {key}
                  </Text>
                </Grid>
                <Grid size={6} sx={{ alignItems: "center" }}>
                  <Text size="xs" sx={{ fontSize: 12, fontWeight: 600 }}>
                    {value}
                  </Text>
                </Grid>
              </React.Fragment>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
};

export default KVCard;
