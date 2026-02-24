import React from "react";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import { Stack } from "@omniviewdev/ui/layout";
import { Text } from "@omniviewdev/ui/typography";

import type { Node } from "kubernetes-types/core/v1";

interface Props {
  node: Node;
}

const InfoEntry: React.FC<{
  label: string;
  value?: string;
}> = ({ label, value }) => {
  if (!value) return null;
  return (
    <Grid container spacing={0} sx={{ minHeight: 22, alignItems: "center" }}>
      <Grid size={4}>
        <Text sx={{ color: "neutral.300" }} size="xs">{label}</Text>
      </Grid>
      <Grid size={8}>
        <Text sx={{ fontWeight: 600, fontSize: 12 }} size="xs" noWrap>{value}</Text>
      </Grid>
    </Grid>
  );
};

const NodeSystemSection: React.FC<Props> = ({ node }) => {
  const info = node.status?.nodeInfo;
  if (!info) return null;

  return (
    <Box sx={{ borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
      <Box sx={{ py: 0.5, px: 1 }}>
        <Stack direction="row" gap={0.75} alignItems="center">
          <Text weight="semibold" size="sm">System</Text>
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ py: 0.5, px: 1, bgcolor: "background.level1" }}>
        <InfoEntry label="OS" value={info.operatingSystem} />
        <InfoEntry label="OS Image" value={info.osImage} />
        <InfoEntry label="Architecture" value={info.architecture} />
        <InfoEntry label="Kernel" value={info.kernelVersion} />
        <InfoEntry label="Runtime" value={info.containerRuntimeVersion} />
        <InfoEntry label="Kubelet" value={info.kubeletVersion} />
        <InfoEntry label="Kube Proxy" value={info.kubeProxyVersion} />
        <InfoEntry label="Machine ID" value={info.machineID} />
      </Box>
    </Box>
  );
};

export default NodeSystemSection;
