import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { ValidatingAdmissionPolicyBinding } from "kubernetes-types/admissionregistration/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<ValidatingAdmissionPolicyBinding>;
}

/**
 * Renders a sidebar for a ValidatingAdmissionPolicyBinding resource
 */
export const ValidatingAdmissionPolicyBindingSidebar: React.FC<Props> = ({ ctx }) => {
  if (!ctx.data) {
    return null;
  }

  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={ctx.data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

ValidatingAdmissionPolicyBindingSidebar.displayName = "ValidatingAdmissionPolicyBindingSidebar";
export default ValidatingAdmissionPolicyBindingSidebar;
