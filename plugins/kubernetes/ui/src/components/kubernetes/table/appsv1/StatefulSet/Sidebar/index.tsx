import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { StatefulSet } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../../../sidebar/Pod/containers";
import { DrawerContext } from "@omniviewdev/runtime";

interface Props {
  ctx: DrawerContext<StatefulSet>;
}

/**
 * Renders a sidebar for a StatefulSet resource
 */
export const StatefulSetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return <></>
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      <ContainersSectionFromPodSpec resourceID={ctx.resource?.id || ''} connectionID={ctx.resource?.connectionID || ''} spec={ctx.data.spec?.template?.spec} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

StatefulSetSidebar.displayName = "StatefulSetSidebar";
export default StatefulSetSidebar;
