import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ReplicaSet } from "kubernetes-types/apps/v1";
import { ResourceSidebarProps } from "../../../../../types/resource";

// project-imports
import ObjectMetaSection from "../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../Pod/containers";

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const ReplicaSetSidebar: React.FC<ResourceSidebarProps> = ({ data }) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as ReplicaSet;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
      <ContainersSectionFromPodSpec spec={obj.spec?.template?.spec} />
    </Stack>
  );
};

ReplicaSetSidebar.displayName = "ReplicaSetSidebar";
export default ReplicaSetSidebar;
