import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";

// types
import { PersistentVolumeClaim } from "kubernetes-types/core/v1";

interface Props {
  data: object;
}

export const PersistentVolumeClaimSidebar: React.FC<Props> = ({ data }) => {
  const node = data as PersistentVolumeClaim;

  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={node.metadata} />
      <pre>{JSON.stringify(data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeClaimSidebar.displayName = "PersistentVolumeClaimSidebar";
export default PersistentVolumeClaimSidebar;
