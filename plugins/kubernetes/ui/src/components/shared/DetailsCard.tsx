import React from "react";

// @omniviewdev/ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { Avatar, ClipboardText } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// project imports
import Icon from "./Icon";

export interface DetailsCardEntry {
  key: string;
  value: string;
  icon?: string | React.ReactNode;
  ratio?: [number, number];
  used?: string;
  defaultValue?: string;
  endAdornment?: React.ReactNode;
  startAdornment?: React.ReactNode;
}

export interface DetailsCardProps {
  title?: string;
  titleSize?: "sm" | "md" | "lg";
  icon?: string | React.ReactNode;
  data: DetailsCardEntry[];
  endAdornment?: React.ReactNode;
  /** Show the kv pair even if the value is undefined */
  showUndefined?: boolean;
}

const sizeConfig = {
  sm: { fontSize: 13, iconSize: 14, headerPy: 0.5, headerPx: 1, bodyP: 1, bodyFontSize: 13, gap: 0.5, gridSpacing: 0.5 },
  md: { fontSize: 14, iconSize: 14, headerPy: 0.75, headerPx: 1.25, bodyP: 1.25, bodyFontSize: 13, gap: 0.75, gridSpacing: 0.5 },
  lg: { fontSize: 16, iconSize: 16, headerPy: 1, headerPx: 1.25, bodyP: 1.25, bodyFontSize: 14, gap: 1, gridSpacing: 0.75 },
} as const;

/**
 * Renders a card for showing a key-value pairs of details
 */
export const DetailsCard: React.FC<DetailsCardProps> = ({
  title,
  titleSize = "md",
  icon,
  data,
  endAdornment,
  showUndefined = false,
}) => {
  const cfg = sizeConfig[titleSize];

  return (
    <Box
      sx={{
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.level1',
        overflow: 'hidden',
      }}
    >
      {title && (
        <Box
          sx={{
            py: cfg.headerPy,
            px: cfg.headerPx,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            bgcolor: 'background.surface',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack
            direction="row"
            gap={cfg.gap}
            alignItems="center"
          >
            {icon &&
              (typeof icon === "string" ? (
                icon.startsWith("http") ? (
                  <Avatar
                    src={icon}
                    size="sm"
                    sx={{ maxHeight: 16, maxWidth: 16, borderRadius: 4 }}
                  />
                ) : (
                  <Icon name={icon} size={cfg.iconSize} />
                )
              ) : (
                icon
              ))}
            <Text sx={{ fontSize: cfg.fontSize }} weight="semibold" size="sm">
              {title}
            </Text>
          </Stack>
          {endAdornment}
        </Box>
      )}
      <Box sx={{ p: cfg.bodyP }}>
        <Grid
          container
          spacing={cfg.gridSpacing}
        >
          {data.map((entry) => {
            if (entry.value || showUndefined) {
              return (
                <React.Fragment key={entry.key}>
                  <Grid size={entry.ratio?.[0] ?? 5}>
                    <Stack direction="row" gap={0.75} alignItems="center">
                      {entry.icon &&
                        (typeof entry.icon === "string" ? (
                          entry.icon.startsWith("http") ? (
                            <Avatar src={entry.icon} size="sm" />
                          ) : (
                            <Icon name={entry.icon} size={cfg.iconSize} />
                          )
                        ) : (
                          icon
                        ))}
                      <Text sx={{ fontSize: cfg.bodyFontSize }}>{entry.key}</Text>
                    </Stack>
                  </Grid>
                  <Grid size={entry.ratio?.[1] ?? 7}>
                    <Stack direction="row" gap={0.75} alignItems="center" justifyContent='space-between'>
                      <ClipboardText
                        value={entry.used ? `${entry.used} / ${entry.value}` : entry.value}
                        variant="inherit"
                        sx={{ color: "neutral.200", fontSize: cfg.bodyFontSize }}
                      />
                      {entry.endAdornment}
                    </Stack>
                  </Grid>
                </React.Fragment>
              );
            }
          })}
        </Grid>
      </Box>
    </Box>
  );
};

DetailsCard.displayName = "DetailsCard";

export default DetailsCard;
