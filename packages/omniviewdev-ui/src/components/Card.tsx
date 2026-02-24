import React from "react";

import Stack from "@mui/material/Stack";
import MuiCard from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

import Icon from "./Icon";

export interface CardProps {
  title?: string;
  icon?: string | React.ReactNode;
  titleDecorator?: string | number | React.ReactNode;
  children?: React.ReactNode;
  /** MUI Card variant */
  variant?: 'outlined' | 'elevation';
  /** Alias for variant using emphasis naming convention */
  emphasis?: 'outline' | 'solid' | 'soft' | 'ghost';
  /** Ignored - accepted for compat but Card doesn't size */
  size?: string;
  /** Remove body padding (useful when children provide their own) */
  noPadding?: boolean;
  onClick?: React.MouseEventHandler;
  sx?: SxProps<Theme>;
}

/**
 * A card with an optional title bar (icon + badge) and content area.
 * When no title is provided, renders as a simple card container.
 */
export const Card: React.FC<CardProps> = ({
  title,
  titleDecorator,
  icon,
  children,
  variant,
  emphasis,
  noPadding = false,
  onClick,
  sx,
}) => {
  const emphasisToVariant: Record<string, 'outlined' | 'elevation'> = {
    outline: 'outlined', solid: 'elevation', soft: 'elevation', ghost: 'outlined',
  };
  const resolvedVariant = variant ?? (emphasis ? emphasisToVariant[emphasis] ?? 'outlined' : 'outlined');

  // Simple card container when no title is provided
  if (!title) {
    return (
      <MuiCard variant={resolvedVariant} onClick={onClick} sx={{ p: noPadding ? 0 : 1.5, gap: 0, ...sx as Record<string, unknown> }}>
        {children}
      </MuiCard>
    );
  }

  return (
    <MuiCard variant={resolvedVariant} onClick={onClick} sx={{ p: 0, gap: 0, ...sx as Record<string, unknown> }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 1 }}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {icon &&
            (typeof icon === "string" ? (
              icon.startsWith("http") ? (
                <Avatar
                  src={icon}
                  sx={{ height: 16, width: 16, borderRadius: "4px" }}
                />
              ) : (
                <Icon name={icon} size={14} />
              )
            ) : (
              icon
            ))}
          <Typography variant="subtitle2">{title}</Typography>
        </Stack>
        {titleDecorator &&
          (typeof titleDecorator === "string" ||
            typeof titleDecorator === "number" ? (
            <Chip
              sx={{ borderRadius: "4px" }}
              size="small"
              color="primary"
              variant="outlined"
              label={titleDecorator}
            />
          ) : (
            titleDecorator
          ))}
      </Stack>
      <Divider />
      <Box sx={{ p: noPadding ? 0 : 1.5 }}>{children}</Box>
    </MuiCard>
  );
};

Card.displayName = "Card";

export default Card;
