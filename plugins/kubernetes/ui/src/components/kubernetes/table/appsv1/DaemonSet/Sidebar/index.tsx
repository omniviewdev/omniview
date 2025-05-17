import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { DaemonSet } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../../../sidebar/Pod/containers";

interface Props {
  data: DaemonSet;
}

/**
 * Renders a sidebar for a DaemonSet resource
 */
export const DaemonSetSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      <ContainersSectionFromPodSpec spec={data.spec?.template?.spec} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

DaemonSetSidebar.displayName = "DaemonSetSidebar";
export default DaemonSetSidebar;
