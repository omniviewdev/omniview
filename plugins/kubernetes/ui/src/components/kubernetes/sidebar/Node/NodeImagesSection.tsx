import React from "react";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

import type { Node } from "kubernetes-types/core/v1";

import { convertKubernetesByteUnits } from "../../../../utils/convert";

interface Props {
  node: Node;
}

const NodeImagesSection: React.FC<Props> = ({ node }) => {
  const images = node.status?.images;
  const [expanded, setExpanded] = React.useState(false);

  if (!images || images.length === 0) return null;

  const totalSize = images.reduce((sum, img) => sum + (img.sizeBytes ?? 0), 0);
  const displayed = expanded ? images : images.slice(0, 5);

  return (
    <Box sx={{ borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
      <Box
        sx={{
          py: 0.5, px: 1,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text weight="semibold" size="sm">Images</Text>
          <Chip
            size="xs"
            emphasis="soft"
            label={`${images.length}`}
            sx={{ borderRadius: 1 }}
          />
        </Stack>
        <Chip
          size="xs"
          emphasis="soft"
          label={convertKubernetesByteUnits({ from: `${totalSize}B`, to: "GB" })}
          sx={{ borderRadius: 1 }}
        />
      </Box>
      <Divider />
      <Box sx={{ py: 0.5, px: 1, bgcolor: "background.level1", maxHeight: 300, overflow: "auto" }}>
        {displayed.map((image, idx) => {
          // Use the shortest name as display name (usually the tag-less sha is longest).
          const displayName = image.names
            ? [...image.names].sort((a, b) => a.length - b.length)[0]
            : `image-${idx}`;
          const sizeStr = image.sizeBytes
            ? convertKubernetesByteUnits({ from: `${image.sizeBytes}B`, to: "MB" })
            : "";

          return (
            <Stack
              key={displayName}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ py: 0.25, minHeight: 20 }}
            >
              <Text size="xs" noWrap sx={{ flex: 1, mr: 1 }}>{displayName}</Text>
              {sizeStr && (
                <Text size="xs" sx={{ color: "neutral.400", flexShrink: 0 }}>{sizeStr}</Text>
              )}
            </Stack>
          );
        })}
        {!expanded && images.length > 5 && (
          <Box
            component="span"
            sx={{ cursor: "pointer", py: 0.25, display: "block" }}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpanded(true); }}
          >
            <Text size="xs" sx={{ color: "primary.main" }}>
              Show all {images.length} images...
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default NodeImagesSection;
