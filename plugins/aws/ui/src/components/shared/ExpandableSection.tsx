import React from "react";

import { ExpandableSections } from "@omniviewdev/ui";
import type { ExpandableSectionItem } from "@omniviewdev/ui";

export type SectionItem = {
  title: string;
  count?: number;
  content: React.ReactNode;
  defaultExpanded?: boolean;
};

interface Props {
  sections: SectionItem[];
}

const ExpandableSection: React.FC<Props> = ({ sections }) => {
  if (sections.length === 0) return null;

  const mapped: ExpandableSectionItem[] = sections.map((section) => ({
    title: section.title,
    count: section.count,
    children: section.content,
    defaultExpanded: section.defaultExpanded,
  }));

  return (
    <ExpandableSections
      sections={mapped}
      variant="bordered"
      size="sm"
    />
  );
};

export default ExpandableSection;
