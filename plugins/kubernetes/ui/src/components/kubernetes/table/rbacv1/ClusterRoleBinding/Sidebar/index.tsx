import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ClusterRoleBinding } from "kubernetes-types/rbac/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: ClusterRoleBinding;
}

/**
 * Renders a sidebar for a ClusterRoleBinding resource
 */
export const ClusterRoleBindingSidebar: React.FC<Props> = ({ data }) => {
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

ClusterRoleBindingSidebar.displayName = "ClusterRoleBindingSidebar";
export default ClusterRoleBindingSidebar;
