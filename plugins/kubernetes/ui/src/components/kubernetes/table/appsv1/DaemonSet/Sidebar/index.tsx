import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { DaemonSet } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { PodContainersSectionFromPodSpec } from "../../../../sidebar/Pod/PodContainersSection";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<DaemonSet>;
}

/**
 * Renders a sidebar for a DaemonSet resource
 */
export const DaemonSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return <></>
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      <PodContainersSectionFromPodSpec resourceID={ctx.resource?.id || ''} connectionID={ctx.resource?.connectionID || ''} spec={ctx.data.spec?.template?.spec} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

DaemonSetSidebar.displayName = "DaemonSetSidebar";
export default DaemonSetSidebar;
