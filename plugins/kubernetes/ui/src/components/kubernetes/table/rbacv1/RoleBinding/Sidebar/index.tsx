import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { RoleBinding } from "kubernetes-types/rbac/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: RoleBinding;
}

/**
 * Renders a sidebar for a RoleBinding resource
 */
export const RoleBindingSidebar: React.FC<Props> = ({ data }) => {
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

RoleBindingSidebar.displayName = "RoleBindingSidebar";
export default RoleBindingSidebar;
