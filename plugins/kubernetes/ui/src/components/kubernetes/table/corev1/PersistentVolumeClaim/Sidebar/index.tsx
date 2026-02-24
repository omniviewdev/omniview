import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { PersistentVolumeClaim } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<PersistentVolumeClaim>;
}

/**
 * Renders a sidebar for a PersistentVolumeClaim resource
 */
export const PersistentVolumeClaimSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

PersistentVolumeClaimSidebar.displayName = "PersistentVolumeClaimSidebar";
export default PersistentVolumeClaimSidebar;
