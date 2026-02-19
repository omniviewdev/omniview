import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ReplicationController } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<ReplicationController>;
}

/**
 * Renders a sidebar for a ReplicaSet resource
 */
export const ReplicationControllerSidebar: React.FC<Props> = ({ ctx }) => {
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

ReplicationControllerSidebar.displayName = "ReplicationControllerSidebar";
export default ReplicationControllerSidebar;
