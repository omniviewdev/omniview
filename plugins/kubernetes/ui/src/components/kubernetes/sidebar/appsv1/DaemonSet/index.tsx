import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { DaemonSet } from "kubernetes-types/apps/v1";

// project-imports
import ObjectMetaSection from "../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../Pod/containers";

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const DaemonSetSidebar: React.FC<{ data: object }> = ({ data }) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as DaemonSet;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
      <ContainersSectionFromPodSpec spec={obj.spec?.template.spec} />
    </Stack>
  );
};

DaemonSetSidebar.displayName = "DaemonSetSidebar";
export default DaemonSetSidebar;
