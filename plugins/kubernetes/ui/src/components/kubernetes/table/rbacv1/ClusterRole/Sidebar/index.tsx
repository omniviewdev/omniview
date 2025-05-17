import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ClusterRole } from "kubernetes-types/rbac/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: ClusterRole;
}

/**
 * Renders a sidebar for a ClusterRole resource
 */
export const ClusterRoleSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <></>
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ClusterRoleSidebar.displayName = "ClusterRoleSidebar";
export default ClusterRoleSidebar;
