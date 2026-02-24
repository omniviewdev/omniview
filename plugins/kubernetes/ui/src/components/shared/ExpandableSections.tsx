import * as React from "react";

import { ExpandableSections as UiExpandableSections } from '@omniviewdev/ui';
import type { ExpandableSectionItem as UiExpandableSection } from '@omniviewdev/ui';

interface Props {
  sections: Array<ExpandableSection>;
  monospace?: boolean;
  variant?: "bordered" | "plain" | "flush";
  size?: "sm" | "md" | "lg";
  exclusive?: boolean;
}

export interface ExpandableSection {
  icon?: string | React.ReactNode;
  title: string | React.ReactNode;
  count?: number;
  endDecorator?: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export default function ExpandableSections({
  sections,
  monospace = false,
  variant = "bordered",
  size = "sm",
  exclusive,
}: Props): React.ReactElement {
  const mappedSections: UiExpandableSection[] = sections.map((section) => ({
    icon: section.icon,
    title: section.title,
    count: section.count,
    endDecorator: section.endDecorator,
    defaultExpanded: section.defaultExpanded,
    children: section.children,
  }));

  return (
    <UiExpandableSections
      sections={mappedSections}
      monospace={monospace}
      variant={variant}
      size={size}
      exclusive={exclusive}
    />
  );
}
