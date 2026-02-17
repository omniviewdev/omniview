import React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Chip,
  Stack,
  Typography,
  accordionDetailsClasses,
  accordionSummaryClasses,
} from "@mui/joy";

type SectionItem = {
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
    <AccordionGroup
      variant="outlined"
      transition="0.2s"
      size="sm"
      sx={{
        borderRadius: "sm",
        [`& .${accordionSummaryClasses.button}:hover`]: { bgcolor: "transparent" },
        [`& .${accordionDetailsClasses.content}`]: {
          backgroundColor: "background.level1",
          boxShadow: (theme) => `inset 0 1px ${theme.vars.palette.divider}`,
          [`&.${accordionDetailsClasses.expanded}`]: { paddingBlock: "0.75rem" },
        },
      }}
    >
      {sections.map((section, i) => (
        <Accordion key={i} defaultExpanded={section.defaultExpanded}>
          <AccordionSummary>
            <Stack direction="row" gap={1} alignItems="center">
              <Typography level="title-sm">{section.title}</Typography>
              {section.count !== undefined && (
                <Chip
                  size="sm"
                  variant="outlined"
                  color="primary"
                  sx={{ borderRadius: "sm" }}
                >
                  {section.count}
                </Chip>
              )}
            </Stack>
          </AccordionSummary>
          <AccordionDetails>{section.content}</AccordionDetails>
        </Accordion>
      ))}
    </AccordionGroup>
  );
};

export type { SectionItem };
export default ExpandableSection;
