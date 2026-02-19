import React from "react";
import MuiCard from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import ButtonBase from "@mui/material/ButtonBase";
import type { SxProps, Theme } from "@mui/material/styles";

export interface ListCardItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  secondary?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
}

export interface ListCardProps {
  /** Card header title */
  title: string;
  /** Icon in the header */
  icon?: React.ReactNode;
  /** Header right-side element (e.g. a count badge or action button) */
  headerAction?: React.ReactNode;
  /** List items */
  items: ListCardItem[];
  /** Max visible items before scrolling */
  maxVisible?: number;
  /** Shown when items is empty */
  emptyMessage?: string;
  sx?: SxProps<Theme>;
}

export default function ListCard({
  title,
  icon,
  headerAction,
  items,
  maxVisible = 5,
  emptyMessage = "No items",
  sx,
}: ListCardProps) {
  const itemHeight = 40;
  const maxHeight = maxVisible * itemHeight;

  return (
    <MuiCard variant="outlined" sx={{ p: 0, ...sx as Record<string, unknown> }}>
      {/* Header */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 1 }}
        alignItems="center"
        justifyContent="space-between"
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          {icon && (
            <Box sx={{ display: "flex", color: "var(--ov-fg-muted)", fontSize: 16 }}>
              {icon}
            </Box>
          )}
          <Typography variant="subtitle2">{title}</Typography>
        </Stack>
        {headerAction}
      </Stack>
      <Divider />

      {/* Items */}
      {items.length === 0 ? (
        <Box sx={{ px: 1.5, py: 2, textAlign: "center" }}>
          <Typography variant="body2" sx={{ color: "var(--ov-fg-faint)" }}>
            {emptyMessage}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ maxHeight, overflowY: "auto" }}>
          {items.map((item, i) => {
            const content = (
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1.5,
                  height: itemHeight,
                  width: "100%",
                  borderBottom: i < items.length - 1 ? "1px solid var(--ov-border-default)" : undefined,
                  "&:hover": item.onClick ? { bgcolor: "var(--ov-bg-surface-hover)" } : undefined,
                  transition: "background-color 0.1s",
                }}
              >
                {item.icon && (
                  <Box sx={{ display: "flex", color: "var(--ov-fg-muted)", fontSize: 16, flexShrink: 0 }}>
                    {item.icon}
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {item.label}
                  </Typography>
                  {item.secondary && (
                    <Typography variant="caption" noWrap sx={{ color: "var(--ov-fg-faint)" }}>
                      {item.secondary}
                    </Typography>
                  )}
                </Box>
                {item.trailing && (
                  <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                    {item.trailing}
                  </Box>
                )}
              </Stack>
            );

            return item.onClick ? (
              <ButtonBase
                key={item.key}
                onClick={item.onClick}
                sx={{ display: "block", width: "100%", textAlign: "left" }}
              >
                {content}
              </ButtonBase>
            ) : (
              <React.Fragment key={item.key}>{content}</React.Fragment>
            );
          })}
        </Box>
      )}
    </MuiCard>
  );
}

ListCard.displayName = "ListCard";
