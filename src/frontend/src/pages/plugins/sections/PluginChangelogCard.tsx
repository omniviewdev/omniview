import * as React from 'react';

// material-ui
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// icons
import InfoOutlined from '@mui/icons-material/InfoOutlined';

// types
import { Changelog } from './PluginChangelog';
import { LuBug, LuRocket, LuShieldQuestion } from 'react-icons/lu';

const PluginChangelogCard: React.FC<Changelog> = ({ version, releaseDate, changes }) => {
  return (
    <Card
      variant="outlined"
      sx={{ width: '100%' }}
    >
      <Stack direction="row" spacing={2} justifyContent={'space-between'}>
        <Typography level="title-lg" startDecorator={<InfoOutlined />}>
          {version}
        </Typography>
        <Chip size="md" color="neutral">{releaseDate}</Chip>
      </Stack>
      <CardContent
        sx={{
          gap: 1,
        }}
      >
        {changes.feature.length > 0 && (
          <Stack direction="column" spacing={1}>
            <Typography level="title-md" startDecorator={<LuRocket />}>
              Features
            </Typography>
            <Divider />
            {changes.feature.map((feature, i) => (
              <Typography key={i} level="body-xs">
                {feature}
              </Typography>
            ))}
          </Stack>
        )}
        {changes.bugfix.length > 0 && (
          <Stack direction="column" spacing={1}>
            <Typography level="title-md" startDecorator={<LuBug />}>
              Bug Fixes
            </Typography>
            <Divider />
            {changes.feature.map((feature, i) => (
              <Typography key={i} level="body-xs">
                {feature}
              </Typography>
            ))}
          </Stack>
        )}
        {changes.security.length > 0 && (
          <Stack direction="column" spacing={1}>
            <Typography level="title-md" startDecorator={<LuShieldQuestion />}>
              Security
            </Typography>
            <Divider />
            {changes.feature.map((feature, i) => (
              <Typography key={i} level="body-xs">
                {feature}
              </Typography>
            ))}
          </Stack>
        )}

      </CardContent>
    </Card>
  );
}

export default PluginChangelogCard;
