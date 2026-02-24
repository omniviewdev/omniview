import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// project-imports
import ObjectMetaSection from "../../shared/ObjectMetaSection";

// types
import { PersistentVolume } from "kubernetes-types/core/v1";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<PersistentVolume>;
}

export const PersistentVolumeSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const pv = ctx.data;

  return (
    <Stack direction="column" width={"100%"} spacing={1}>
      <ObjectMetaSection data={pv.metadata} />
      <pre>{JSON.stringify(ctx.data, null, 2)}</pre>;
    </Stack>
  );
};

PersistentVolumeSidebar.displayName = "PersistentVolumeSidebar";
export default PersistentVolumeSidebar;
