import * as React from "react";

// material-ui
import Avatar from "@mui/joy/Avatar";
import AccordionGroup from "@mui/joy/AccordionGroup";
import Accordion from "@mui/joy/Accordion";
import AccordionDetails, {
  accordionDetailsClasses,
} from "@mui/joy/AccordionDetails";
import AccordionSummary, {
  accordionSummaryClasses,
} from "@mui/joy/AccordionSummary";
import Chip from "@mui/joy/Chip";
import Stack from "@mui/joy/Stack";
import Typography from "@mui/joy/Typography";

// project imports
import DynamicIcon from "../../stories/components/DynamicIcon";

interface Props {
  sections: Array<ExpandableSection>;
  monospace?: boolean;
}

export interface ExpandableSection {
  icon?: string | React.ReactNode;
  title: string;
  endDecorator?: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export default function ExpandableSections({
  sections,
  monospace = false,
}: Props): React.ReactElement {
  return (
    <AccordionGroup
      size="sm"
      variant="outlined"
      transition="0.1s"
      sx={{
        borderRadius: "sm",
        flexGrow: 0,
        [`& .${accordionSummaryClasses.button}:hover`]: {
          bgcolor: "transparent",
        },
        [`& .${accordionDetailsClasses.content}`]: {
          boxShadow: (theme) => `inset 0 1px ${theme.vars.palette.divider}`,
          transition: "0.2s",
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
            <Stack
              direction="row"
              spacing={1}
              alignItems={"center"}
              justifyContent={"space-between"}
              width={"100%"}
            >
              <Chip
                size="md"
                color="neutral"
                variant="soft"
                sx={{ borderRadius: "sm" }}
                startDecorator={
                  section.icon &&
                  (typeof section.icon === "string" ? (
                    section.icon.startsWith("http") ? (
                      <Avatar
                        src={section.icon}
                        size="sm"
                        sx={{
                          maxHeight: 16,
                          maxWidth: 16,
                          borderRadius: "2px",
                          ml: "0px",
                        }}
                      />
                    ) : (
                      <DynamicIcon name={section.icon} size={14} />
                    )
                  ) : (
                    section.icon
                  ))
                }
              >
                <Typography
                  fontFamily={monospace ? "monospace" : "inherit"}
                  px={0.5}
                  textColor={"neutral.50"}
                  fontSize={monospace ? 12 : 13}
                >
                  {section.title}
                </Typography>
              </Chip>
              {section.endDecorator && section.endDecorator}
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>{section.children}</AccordionDetails>
        </Accordion>
      ))}
    </AccordionGroup>
  );
}
