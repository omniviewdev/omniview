import React from "react";
import DetailsCard from "../../../shared/DetailsCard";
import type { DetailEntry } from "../../../shared/DetailsCard";
import ExpandableSection from "../../../shared/ExpandableSection";
import type { SectionItem } from "../../../shared/ExpandableSection";

interface Props {
  groups: Array<{ GroupId?: string; GroupName?: string }>;
}

/**
 * Displays a list of security groups as expandable sections,
 * each showing the Group ID and Group Name.
 */
const SecurityGroupsSection: React.FC<Props> = ({ groups }) => {
  if (!groups || groups.length === 0) return null;

  const sections: SectionItem[] = groups.map((sg) => {
    const entries: DetailEntry[] = [
      { label: "Group ID", value: sg.GroupId },
      { label: "Group Name", value: sg.GroupName },
    ];

    return {
      title: sg.GroupName || sg.GroupId || "Unknown SG",
      content: <DetailsCard title="Details" entries={entries} />,
      defaultExpanded: false,
    };
  });

  return <ExpandableSection sections={sections} />;
};

export default SecurityGroupsSection;
