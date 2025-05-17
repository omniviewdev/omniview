import React from "react";

// material-ui
import Stack from "@mui/joy/Stack";

// types
import { MutatingWebhookConfiguration } from "kubernetes-types/admissionregistration/v1";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  data?: MutatingWebhookConfiguration;
}

/**
 * Renders a sidebar for a MutatingWebhookConfiguration resource
 */
export const MutatingWebhookConfigurationSidebar: React.FC<Props> = ({ data }) => {
  if (!data) {
    return <></>
  }

  return (
    <Stack direction="column" width={"100%"} spacing={2}>
      <ObjectMetaSection data={data.metadata} />
      {/** TODO: fill this in with more data */}
    </Stack>
  );
};

MutatingWebhookConfigurationSidebar.displayName = "MutatingWebhookConfigurationSidebar";
export default MutatingWebhookConfigurationSidebar;
