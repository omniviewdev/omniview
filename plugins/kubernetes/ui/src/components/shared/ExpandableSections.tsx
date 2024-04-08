import * as React from "react";

// material-ui
import Avatar from "@mui/joy/Avatar";
import AccordionGroup from "@mui/joy/AccordionGroup";
import Accordion, { accordionClasses } from "@mui/joy/Accordion";
import AccordionDetails from "@mui/joy/AccordionDetails";
import AccordionSummary from "@mui/joy/AccordionSummary";
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
      variant="soft"
      transition="0.1s"
      sx={{
        borderRadius: "sm",
        border: (theme) => `1px solid ${theme.palette.divider}`,
        flexGrow: 0,
        [`& .${accordionClasses.root}`]: {
          transition: '0.2s ease',
          '& button:not([aria-expanded="true"])': {
            transition: '0.2s ease',
          },
          '& button:hover': {
            background: 'transparent',
          },
        },
        [`& .${accordionClasses.root}.${accordionClasses.expanded}`]: {
          bgcolor: 'background.level1',
          borderRadius: 'sm',
        },
      }}
    >
      {sections.map((section) => (
        <Accordion key={section.title} defaultExpanded={section.defaultExpanded}>
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
                  m={'3px'}
                  fontSize={monospace ? 13 : 14}
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
