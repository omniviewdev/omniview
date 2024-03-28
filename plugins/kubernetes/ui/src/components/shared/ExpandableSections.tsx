import * as React from "react";

// material-ui
import AccordionGroup from "@mui/joy/AccordionGroup";
import Accordion from "@mui/joy/Accordion";
import AccordionDetails, {
  accordionDetailsClasses,
} from "@mui/joy/AccordionDetails";
import AccordionSummary, {
  accordionSummaryClasses,
} from "@mui/joy/AccordionSummary";
import DynamicIcon from "../../stories/components/DynamicIcon";
import { Chip, Typography } from "@mui/joy";

interface Props {
  sections: Array<ExpandableSection>;
}

interface ExpandableSection {
  icon?: string | React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export default function ExpandableSections({
  sections,
}: Props): React.ReactElement {
  return (
    <AccordionGroup
      size="sm"
      variant="outlined"
      transition="0.2s"
      sx={{
        borderRadius: "sm",
        [`& .${accordionSummaryClasses.button}:hover`]: {
          bgcolor: "transparent",
        },
        [`& .${accordionDetailsClasses.content}`]: {
          boxShadow: (theme) => `inset 0 1px ${theme.vars.palette.divider}`,
          [`&.${accordionDetailsClasses.expanded}`]: {
            paddingBlock: "0.25rem",
            p: "0.25rem",
          },
        },
      }}
    >
      {sections.map((section) => (
        <Accordion defaultExpanded={section.defaultExpanded}>
          <AccordionSummary sx={{ pl: 0.5 }}>
            <Chip
              size="md"
              color="neutral"
              variant="soft"
              sx={{ borderRadius: "sm" }}
              startDecorator={
                section.icon && typeof section.icon === "string" ? (
                  <DynamicIcon name={section.icon} size={14} />
                ) : (
                  section.icon
                )
              }
            >
              <Typography
                fontFamily={"monospace"}
                px={0.5}
                textColor={"neutral.50"}
                fontSize={12}
              >
                {section.title}
              </Typography>
            </Chip>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>{section.children}</AccordionDetails>
        </Accordion>
      ))}
    </AccordionGroup>
  );
}
