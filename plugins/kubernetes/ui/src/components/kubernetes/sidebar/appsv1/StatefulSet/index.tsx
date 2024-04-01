import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { StatefulSet } from "kubernetes-types/apps/v1";
import { ResourceSidebarProps } from "../../../../../types/resource";

// project-imports
import ObjectMetaSection from "../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../Pod/containers";

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const StatefulSetSidebar: React.FC<ResourceSidebarProps> = ({
  data,
}) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as StatefulSet;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
      <ContainersSectionFromPodSpec spec={obj.spec?.template?.spec} />
    </Stack>
  );
};

StatefulSetSidebar.displayName = "StatefulSetSidebar";
export default StatefulSetSidebar;
