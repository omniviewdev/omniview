import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { ClusterRoleBinding } from "kubernetes-types/rbac/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<ClusterRoleBinding>;
}

/**
 * Renders a sidebar for a ClusterRoleBinding resource
 */
export const ClusterRoleBindingSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  const data = ctx.data;

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
