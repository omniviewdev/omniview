import React from 'react';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import TextField from '@mui/material/TextField';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import type { HomepageCardConfig, HomepageCardMeta } from '@/features/extensions/homepage/types';

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  meta: HomepageCardMeta;
  config: HomepageCardConfig;
  onConfigChange: (config: HomepageCardConfig) => void;
};

const HomepageCardConfigPopover: React.FC<Props> = ({
  anchorEl,
  onClose,
  meta,
  config,
  onConfigChange,
}) => {
  const [maxItemsInput, setMaxItemsInput] = React.useState(String(config.maxItems ?? 5));
  const allSections = meta.defaultConfig.sections;

  const toggleSection = (section: string) => {
    const next = config.sections.includes(section)
      ? config.sections.filter((s) => s !== section)
      : [...config.sections, section];
    onConfigChange({ ...config, sections: next });
  };

  const handleMaxItems = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMaxItemsInput(e.target.value);
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 20) {
      onConfigChange({ ...config, maxItems: val });
    }
  };

  const maxItemsError = (() => {
    const val = parseInt(maxItemsInput, 10);
    if (isNaN(val) || val < 1) return 'Must be at least 1';
    if (val > 20) return 'Must be at most 20';
    return null;
  })();

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Box sx={{ p: 2, minWidth: 200 }}>
        <Stack direction="column" gap={1.5}>
          <Text size="sm" weight="semibold">
            Card Settings
          </Text>

          <Box>
            <Text size="xs" sx={{ color: 'text.secondary', mb: 0.5 }}>
              Sections
            </Text>
            <FormGroup>
              {allSections.map((section) => (
                <FormControlLabel
                  key={section}
                  control={
                    <Checkbox
                      size="small"
                      checked={config.sections.includes(section)}
                      onChange={() => toggleSection(section)}
                    />
                  }
                  label={<Text size="sm">{section}</Text>}
                />
              ))}
            </FormGroup>
          </Box>

          <TextField
            label="Max items per section"
            type="number"
            size="small"
            value={maxItemsInput}
            onChange={handleMaxItems}
            inputProps={{ min: 1, max: 20 }}
            error={Boolean(maxItemsError)}
            helperText={maxItemsError ?? undefined}
          />
        </Stack>
      </Box>
    </Popover>
  );
};

export default HomepageCardConfigPopover;
