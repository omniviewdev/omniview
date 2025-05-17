import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// project-imports

// types
import { PersistentVolume } from "kubernetes-types/core/v1";
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data: PersistentVolume;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ data }) => {

  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={data.metadata} />
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = "PersistentVolumeSidebar";
export default PersistentVolumeSidebar;
