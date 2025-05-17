import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Deployment } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../../../sidebar/Pod/containers";

interface Props {
  data: Deployment;
}

/**
 * Renders a sidebar for a Deployment resource
 */
export const DeploymentSidebar: React.FC<Props> = ({ data }) => {

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      <ContainersSectionFromPodSpec spec={data.spec?.template?.spec} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

DeploymentSidebar.displayName = "DeploymentSidebar";
export default DeploymentSidebar;
