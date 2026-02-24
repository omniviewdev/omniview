import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { PodDisruptionBudget } from "kubernetes-types/policy/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<PodDisruptionBudget>;
}

/**
 * Renders a sidebar for a PodDisruptionBudget resource
 */
export const PodDisruptionBudgetSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  // compose your component here
  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

PodDisruptionBudgetSidebar.displayName = "PodDisruptionBudgetSidebar";
export default PodDisruptionBudgetSidebar;
