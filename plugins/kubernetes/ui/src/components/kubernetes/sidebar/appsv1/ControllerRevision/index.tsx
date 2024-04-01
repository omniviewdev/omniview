import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ControllerRevision } from "kubernetes-types/apps/v1";
import { ResourceSidebarProps } from "../../../../../types/resource";

// project-imports
import ObjectMetaSection from "../../../../shared/ObjectMetaSection";
import { ContainersSectionFromPodSpec } from "../../Pod/containers";

/**
 * Renders a sidebar for a ConfigMap resource
 */
export const ControllerRevisionSidebar: React.FC<ResourceSidebarProps> = ({
  data,
}) => {
  if (!data) {
    return <React.Fragment />;
  }

  // assert this is a ConfigMap
  const obj = data as ControllerRevision;

  // @ts-expect-error // blank interface, so we have to unsafely case and check on the way down
  const podSpec = obj.data?.["spec"]?.["template"]?.["spec"] as PodSpec;

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={obj.metadata} />
      {podSpec !== undefined && <ContainersSectionFromPodSpec spec={podSpec} />}
    </Stack>
  );
};

ControllerRevisionSidebar.displayName = "ControllerRevisionSidebar";
export default ControllerRevisionSidebar;
