import React from "react";

import Avatar from "@mui/material/Avatar";
import MuiCard from "@mui/material/Card";

import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

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

const getTitleFontSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm": return 12;
    case "md": return 14;
    case "lg": return 16;
    default:   return 14;
  }
};

const getTitleContainerSpacing = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm": return 0.5;
    case "md": return 1;
    case "lg": return 2;
    default:   return 1;
  }
};

const getTitleIconSize = (size: "sm" | "md" | "lg") => {
  switch (size) {
    case "sm": return 12;
    case "md": return 14;
    case "lg": return 16;
    default:   return 14;
  }
};

/**
 * A card for showing key-value pairs of details with icons and grid ratios.
 */
export const DetailsCard: React.FC<DetailsCardProps> = ({
  title,
  titleSize = "md",
  icon,
  data,
  endAdornment,
  showUndefined = false,
}) => {
  return (
    <MuiCard
      variant="outlined"
      sx={{
        p: 0,
        gap: 0,
        bgcolor: "var(--ov-bg-surface-raised)",
      }}
    >
      {title && (
        <Box
          sx={{
            px: 1.5,
            py: 1,
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            bgcolor: "var(--ov-bg-surface)",
            borderBottom: "1px solid var(--ov-border-default)",
          }}
        >
          <Stack
            direction="row"
            spacing={getTitleContainerSpacing(titleSize)}
            alignItems="center"
          >
            {icon &&
              (typeof icon === "string" ? (
                icon.startsWith("http") ? (
                  <Avatar
                    src={icon}
                    sx={{ height: 16, width: 16, borderRadius: "4px" }}
                  />
                ) : (
                  <Icon name={icon} size={getTitleIconSize(titleSize)} />
                )
              ) : (
                icon
              ))}
            <Typography
              sx={{ fontSize: getTitleFontSize(titleSize) }}
              variant="subtitle2"
            >
              {title}
            </Typography>
          </Stack>
          {endAdornment}
        </Box>
      )}
      <Box sx={{ px: 1.5, py: 1 }}>
        <Grid container spacing={1}>
          {data.map((entry) => {
            if (entry.value || showUndefined) {
              return (
                <React.Fragment key={entry.key}>
                  <Grid size={entry.ratio?.[0] ?? 5}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {entry.icon &&
                        (typeof entry.icon === "string" ? (
                          entry.icon.startsWith("http") ? (
                            <Avatar
                              src={entry.icon}
                              sx={{ width: 24, height: 24 }}
                            />
                          ) : (
                            <Icon name={entry.icon} size={14} />
                          )
                        ) : (
                          entry.icon
                        ))}
                      <Typography variant="caption">{entry.key}</Typography>
                    </Stack>
                  </Grid>
                  <Grid size={entry.ratio?.[1] ?? 7}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Typography
                        variant="caption"
                        noWrap
                        sx={{ color: "var(--ov-fg-default)" }}
                      >
                        {entry.used
                          ? `${entry.used} / ${entry.value}`
                          : entry.value}
                      </Typography>
                      {entry.endAdornment}
                    </Stack>
                  </Grid>
                </React.Fragment>
              );
            }
          })}
        </Grid>
      </Box>
    </MuiCard>
  );
};

DetailsCard.displayName = "DetailsCard";

export default DetailsCard;
