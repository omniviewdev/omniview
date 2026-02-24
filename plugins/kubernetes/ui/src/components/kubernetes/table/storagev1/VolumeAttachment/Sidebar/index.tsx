import React from "react";

// material-ui
import { Stack } from "@omniviewdev/ui/layout";

// types
import { VolumeAttachment } from "kubernetes-types/storage/v1";
import { DrawerContext } from "@omniviewdev/runtime";

// project-imports
import ObjectMetaSection from "../../../../../shared/ObjectMetaSection";

interface Props {
  ctx: DrawerContext<VolumeAttachment>;
}

/**
 * Renders a sidebar for a VolumeAttachment resource
 */
export const VolumeAttachmentSidebar: React.FC<Props> = ({ ctx }) => {
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

VolumeAttachmentSidebar.displayName = "VolumeAttachmentSidebar";
export default VolumeAttachmentSidebar;
