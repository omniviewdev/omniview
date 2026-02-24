import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { NetworkPolicy } from "kubernetes-types/networking/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<NetworkPolicy>;
}

/**
 * Renders a sidebar for a NetworkPolicy resource
 */
export const NetworkPolicySidebar: React.FC<Props> = ({ ctx }) => {
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

NetworkPolicySidebar.displayName = "NetworkPolicySidebar";
export default NetworkPolicySidebar;
