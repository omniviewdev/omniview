import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// project-imports

// types
import { PersistentVolume } from "kubernetes-types/core/v1";
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<PersistentVolume>;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={ctx.data.metadata} />
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = "PersistentVolumeSidebar";
export default PersistentVolumeSidebar;
