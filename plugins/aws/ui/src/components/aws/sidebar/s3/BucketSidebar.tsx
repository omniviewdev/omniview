import React from "react";
import { Stack } from '@omniviewdev/base-ui';
import MetadataSection from "../../../shared/sidebar/pages/overview/sections/MetadataSection";
import DetailsCard from "../../../shared/DetailsCard";
import TagsSection from "../sections/TagsSection";

interface Props {
  ctx: { data?: Record<string, any> };
}

const BucketSidebar: React.FC<Props> = ({ ctx }) => {
  const data = ctx.data || {};

  return (
    <Stack direction="column" spacing={2} style={{ width: "100%" }}>
      <MetadataSection data={data} />

      <DetailsCard
        title="Bucket Info"
        entries={[
          { label: "Name", value: data?.Name },
          { label: "ARN", value: data?.Name ? `arn:aws:s3:::${data.Name}` : undefined },
          { label: "Region", value: data?.Region },
          { label: "Creation Date", value: data?.CreationDate },
        ]}
      />

      <TagsSection data={data} />
    </Stack>
  );
};

export default BucketSidebar;
