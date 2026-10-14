import React from "react";

import { Accordion } from "@omniviewdev/base-ui";

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

  return (
    <Accordion size="sm">
      {sections.map((section, i) => (
        <Accordion.Item
          key={`${i}-${section.title}`}
          id={`${i}-${section.title}`}
          title={section.title}
          count={section.count}
          defaultExpanded={section.defaultExpanded}
        >
          {section.content}
        </Accordion.Item>
      ))}
    </Accordion>
  );
};

export default ExpandableSection;
