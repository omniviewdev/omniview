import React from "react";
import MuiCard from "@mui/material/Card";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";

export interface MediaCardProps {
  /** Image URL or ReactNode for the media area */
  media: string | React.ReactNode;
  /** Media area height in px */
  mediaHeight?: number;
  /** Card title */
  title: string;
  /** Short description */
  description?: string;
  /** Small metadata line (e.g. author, date) */
  meta?: string | React.ReactNode;
  /** Action buttons rendered at the bottom */
  actions?: React.ReactNode;
  /** Click handler for the entire card */
  onClick?: () => void;
  sx?: SxProps<Theme>;
}

export default function MediaCard({
  media,
  mediaHeight = 140,
  title,
  description,
  meta,
  actions,
  onClick,
  sx,
}: MediaCardProps) {
  return (
    <MuiCard
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 0,
        cursor: onClick ? "pointer" : undefined,
        transition: "border-color 0.15s, box-shadow 0.15s",
        "&:hover": onClick
          ? {
              borderColor: "var(--ov-border-focus)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }
          : undefined,
        ...sx as Record<string, unknown>,
      }}
    >
      {/* Media */}
      {typeof media === "string" ? (
        <Box
          sx={{
            height: mediaHeight,
            width: "100%",
            backgroundImage: `url(${media})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            borderBottom: "1px solid var(--ov-border-default)",
          }}
        />
      ) : (
        <Box
          sx={{
            height: mediaHeight,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "var(--ov-bg-surface)",
            borderBottom: "1px solid var(--ov-border-default)",
            color: "var(--ov-fg-faint)",
            fontSize: 40,
          }}
        >
          {media}
        </Box>
      )}

      {/* Content */}
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            sx={{
              color: "var(--ov-fg-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {description}
          </Typography>
        )}
        {meta && (
          <Typography
            variant="caption"
            component="div"
            sx={{ color: "var(--ov-fg-faint)", mt: 0.5 }}
          >
            {meta}
          </Typography>
        )}
      </Box>

      {/* Actions */}
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 1.5,
            py: 1,
            borderTop: "1px solid var(--ov-border-default)",
          }}
        >
          {actions}
        </Stack>
      )}
    </MuiCard>
  );
}

MediaCard.displayName = "MediaCard";
