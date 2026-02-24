import React from "react";

// @omniviewdev/ui
import Box from "@mui/material/Box";
import { Chip } from "@omniviewdev/ui";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

// project imports
import DetailsCard, { DetailsCardEntry } from "../../../shared/DetailsCard";
import ExpandableSections from "../../../shared/ExpandableSections";

// types
import type { Pod, Volume } from "kubernetes-types/core/v1";

interface Props {
  pod: Pod;
}

function getVolumeInfo(
  volume: Volume,
): { type: string; details: DetailsCardEntry[] } {
  if (volume.configMap) {
    return {
      type: "ConfigMap",
      details: [
        { key: "ConfigMap Name", value: volume.configMap.name || "" },
        ...(volume.configMap.optional != null
          ? [{ key: "Optional", value: String(volume.configMap.optional) }]
          : []),
        ...(volume.configMap.defaultMode != null
          ? [
              {
                key: "Default Mode",
                value: String(volume.configMap.defaultMode),
              },
            ]
          : []),
      ],
    };
  }

  if (volume.secret) {
    return {
      type: "Secret",
      details: [
        { key: "Secret Name", value: volume.secret.secretName || "" },
        ...(volume.secret.optional != null
          ? [{ key: "Optional", value: String(volume.secret.optional) }]
          : []),
        ...(volume.secret.defaultMode != null
          ? [
              {
                key: "Default Mode",
                value: String(volume.secret.defaultMode),
              },
            ]
          : []),
      ],
    };
  }

  if (volume.persistentVolumeClaim) {
    return {
      type: "PVC",
      details: [
        { key: "Claim Name", value: volume.persistentVolumeClaim.claimName },
        {
          key: "Read Only",
          value: String(volume.persistentVolumeClaim.readOnly ?? false),
        },
      ],
    };
  }

  if (volume.emptyDir) {
    const details: DetailsCardEntry[] = [];
    if (volume.emptyDir.medium)
      details.push({ key: "Medium", value: volume.emptyDir.medium });
    if (volume.emptyDir.sizeLimit)
      details.push({
        key: "Size Limit",
        value: String(volume.emptyDir.sizeLimit),
      });
    if (details.length === 0)
      details.push({ key: "Medium", value: "Default (disk)" });
    return { type: "EmptyDir", details };
  }

  if (volume.hostPath) {
    return {
      type: "HostPath",
      details: [
        { key: "Path", value: volume.hostPath.path },
        ...(volume.hostPath.type
          ? [{ key: "Type", value: volume.hostPath.type }]
          : []),
      ],
    };
  }

  if (volume.projected) {
    const sources = volume.projected.sources || [];
    const sourceTypes = sources
      .map((s) => {
        if (s.serviceAccountToken) return "ServiceAccountToken";
        if (s.configMap) return "ConfigMap";
        if (s.secret) return "Secret";
        if (s.downwardAPI) return "DownwardAPI";
        return "Unknown";
      })
      .join(", ");
    return {
      type: "Projected",
      details: [
        { key: "Sources", value: sourceTypes },
        ...(volume.projected.defaultMode != null
          ? [
              {
                key: "Default Mode",
                value: String(volume.projected.defaultMode),
              },
            ]
          : []),
      ],
    };
  }

  if (volume.downwardAPI) {
    const items = volume.downwardAPI.items || [];
    return {
      type: "DownwardAPI",
      details: items.map((item) => ({
        key: item.path,
        value:
          item.fieldRef?.fieldPath || item.resourceFieldRef?.resource || "",
      })),
    };
  }

  if (volume.csi) {
    return {
      type: "CSI",
      details: [
        { key: "Driver", value: volume.csi.driver },
        ...(volume.csi.readOnly != null
          ? [{ key: "Read Only", value: String(volume.csi.readOnly) }]
          : []),
        ...(volume.csi.fsType
          ? [{ key: "FS Type", value: volume.csi.fsType }]
          : []),
      ],
    };
  }

  if (volume.nfs) {
    return {
      type: "NFS",
      details: [
        { key: "Server", value: volume.nfs.server },
        { key: "Path", value: volume.nfs.path },
        { key: "Read Only", value: String(volume.nfs.readOnly ?? false) },
      ],
    };
  }

  return { type: "Unknown", details: [] };
}

// ── IDE-style section heading ──
const SectionHeading: React.FC<{ label: string; count: number }> = ({
  label,
  count,
}) => (
  <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.75 }}>
    <Text
      size="xs"
      weight="semibold"
      sx={{
        color: "text.secondary",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontSize: 11,
        flexShrink: 0,
      }}
    >
      {label}
    </Text>
    <Chip
      size="xs"
      emphasis="outline"
      color="primary"
      sx={{ borderRadius: 1, flexShrink: 0 }}
      label={String(count)}
    />
    <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
  </Stack>
);

const PodVolumesSection: React.FC<Props> = ({ pod }) => {
  const volumes = pod.spec?.volumes;
  if (!volumes || volumes.length === 0) return null;

  const sections = volumes.map((volume) => {
    const { type, details } = getVolumeInfo(volume);
    return {
      icon: "LuHardDrive",
      title: volume.name,
      endDecorator: (
        <Chip
          size="xs"
          emphasis="outline"
          color="primary"
          sx={{ borderRadius: 1 }}
          label={type}
        />
      ),
      children: details.length > 0 ? <DetailsCard data={details} /> : null,
    };
  });

  return (
    <Box>
      <SectionHeading label="Volumes" count={volumes.length} />
      <ExpandableSections sections={sections} size="sm" />
    </Box>
  );
};

export default PodVolumesSection;
