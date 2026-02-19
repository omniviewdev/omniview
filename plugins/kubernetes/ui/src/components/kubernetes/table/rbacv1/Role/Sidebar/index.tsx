import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { Role } from "kubernetes-types/rbac/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<Role>;
}

/**
 * Renders a sidebar for a Role resource
 */
export const RoleSidebar: React.FC<Props> = ({ ctx }) => {
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

RoleSidebar.displayName = "RoleSidebar";
export default RoleSidebar;
