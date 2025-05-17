import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ReplicaSet } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../../../sidebar/Pod/containers";

interface Props {
  data: ReplicaSet;
}

/**
 * Renders a sidebar for a ReplicaSet resource
 */
export const ReplicaSetSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      <ContainersSectionFromPodSpec spec={data.spec?.template?.spec} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ReplicaSetSidebar.displayName = "ReplicaSetSidebar";
export default ReplicaSetSidebar;
