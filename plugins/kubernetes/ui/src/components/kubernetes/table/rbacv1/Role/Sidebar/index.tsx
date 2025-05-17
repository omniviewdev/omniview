import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Role } from "kubernetes-types/rbac/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: Role;
}

/**
 * Renders a sidebar for a Role resource
 */
export const RoleSidebar: React.FC<Props> = ({ data }) => {
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

RoleSidebar.displayName = "RoleSidebar";
export default RoleSidebar;
