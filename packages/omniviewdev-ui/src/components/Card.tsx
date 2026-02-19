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
  title: string;
  icon?: string | React.ReactNode;
  titleDecorator?: string | number | React.ReactNode;
  children?: React.ReactNode;
  /** Remove body padding (useful when children provide their own) */
  noPadding?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * A card with a title bar (icon + badge) and content area.
 */
export const Card: React.FC<CardProps> = ({
  title,
  titleDecorator,
  icon,
  children,
  noPadding = false,
  sx,
}) => {
  return (
    <MuiCard variant="outlined" sx={{ p: 0, gap: 0, ...sx as Record<string, unknown> }}>
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
