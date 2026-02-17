import React from "react";
import DetailsCard from "../../../shared/DetailsCard";
import type { DetailEntry } from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import type { SectionItem } from "../../../shared/ExpandableSection";

interface Props {
  devices: Array<Record<string, any>>;
}

/**
 * Displays block device mappings from an EC2 instance as expandable sections,
 * each showing volume details such as volume ID, size, type, and attach time.
 */
const StorageSection: React.FC<Props> = ({ devices }) => {
  if (!devices || devices.length === 0) return null;

  const sections: SectionItem[] = devices.map((device, i) => {
    const ebs = device.Ebs || {};
    const deviceName = device.DeviceName || `Device ${i + 1}`;

    const entries: DetailEntry[] = [
      { label: "Device Name", value: device.DeviceName },
      { label: "Volume ID", value: ebs.VolumeId },
      { label: "Volume Size", value: ebs.VolumeSize ? `${ebs.VolumeSize} GiB` : undefined },
      { label: "Volume Type", value: ebs.VolumeType },
      { label: "Status", value: ebs.Status },
      { label: "Encrypted", value: ebs.Encrypted },
      { label: "Delete on Termination", value: ebs.DeleteOnTermination },
      {
        label: "Attach Time",
        value: ebs.AttachTime ? String(ebs.AttachTime) : undefined,
      },
    ];

    return {
      title: deviceName,
      content: <DetailsCard title="Volume" entries={entries} />,
      defaultExpanded: i === 0,
    };
  });

  return <ExpandableSection sections={sections} />;
};

export default StorageSection;
