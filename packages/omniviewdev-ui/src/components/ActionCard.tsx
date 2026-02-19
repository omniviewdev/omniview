import React from "react";
import MuiCard from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";

export interface ActionCardProps {
  /** Icon displayed above the title */
  icon?: React.ReactNode;
  /** Card title */
  title: string;
  /** Description text */
  description?: string;
  /** Primary action (e.g. a Button) */
  primaryAction?: React.ReactNode;
  /** Secondary action (e.g. a text Button) */
  secondaryAction?: React.ReactNode;
  /** Horizontal or vertical layout */
  direction?: "horizontal" | "vertical";
  sx?: SxProps<Theme>;
}

export default function ActionCard({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  direction = "vertical",
  sx,
}: ActionCardProps) {
  const isHorizontal = direction === "horizontal";

  return (
    <MuiCard
      variant="outlined"
      sx={{
        p: 2,
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        alignItems: isHorizontal ? "center" : "flex-start",
        gap: isHorizontal ? 2 : 1,
        ...sx as Record<string, unknown>,
      }}
    >
      {icon && (
        <Box
          sx={{
            fontSize: 32,
            color: "var(--ov-fg-muted)",
            display: "flex",
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" sx={{ color: "var(--ov-fg-muted)" }}>
            {description}
          </Typography>
        )}
      </Box>

      {(primaryAction || secondaryAction) && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            mt: isHorizontal ? 0 : 1,
            flexShrink: 0,
          }}
        >
          {primaryAction}
          {secondaryAction}
        </Stack>
      )}
    </MuiCard>
  );
}

ActionCard.displayName = "ActionCard";
