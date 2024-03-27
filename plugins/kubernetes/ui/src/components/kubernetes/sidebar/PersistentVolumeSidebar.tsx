import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";

// types
import { PersistentVolume } from "kubernetes-types/core/v1";

interface Props {
  data: object;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ data }) => {
  const pv = data as PersistentVolume;

  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={pv.metadata} />
      <pre>{JSON.stringify(data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = "PersistentVolumeSidebar";
export default PersistentVolumeSidebar;
