import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { ServiceAccount } from "kubernetes-types/core/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: ServiceAccount;
}

/**
 * Renders a sidebar for a ServiceAccount resource
 */
export const ServiceAccountSidebar: React.FC<Props> = ({ data }) => {
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

ServiceAccountSidebar.displayName = "ServiceAccountSidebar";
export default ServiceAccountSidebar;
