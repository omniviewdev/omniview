import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { CronJob } from "kubernetes-types/batch/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<CronJob>;
}

/**
 * Renders a sidebar for a ReplicaSet resource
 */
export const CronJobSidebar: React.FC<Props> = ({ ctx }) => {
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

CronJobSidebar.displayName = "CronJobSidebar";
export default CronJobSidebar;
