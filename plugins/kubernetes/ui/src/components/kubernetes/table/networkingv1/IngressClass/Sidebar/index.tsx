import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { IngressClass } from "kubernetes-types/networking/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<IngressClass>;
}

/**
 * Renders a sidebar for a IngressClass resource
 */
export const IngressClassSidebar: React.FC<Props> = ({ ctx }) => {
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

IngressClassSidebar.displayName = "IngressClassSidebar";
export default IngressClassSidebar;
