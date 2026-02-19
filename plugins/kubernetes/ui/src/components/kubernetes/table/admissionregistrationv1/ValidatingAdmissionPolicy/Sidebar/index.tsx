import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ValidatingAdmissionPolicy } from "kubernetes-types/admissionregistration/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<ValidatingAdmissionPolicy>;
}

/**
 * Renders a sidebar for a ValidatingAdmissionPolicy resource
 */
export const ValidatingAdmissionPolicySidebar: React.FC<Props> = ({ ctx }) => {
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

ValidatingAdmissionPolicySidebar.displayName = "ValidatingAdmissionPolicySidebar";
export default ValidatingAdmissionPolicySidebar;
