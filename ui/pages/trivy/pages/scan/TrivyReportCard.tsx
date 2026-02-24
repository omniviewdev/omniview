import * as React from 'react';

// material-ui
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Card } from '@omniviewdev/ui';
import Box from '@mui/material/Box';
import Icon from '@/components/icons/Icon';
import { Link } from 'react-router-dom';

type Props = {
  scanner: string;
  title: string;
  description: string;
  icon: string;
};

export const TrivyReportCard: React.FC<Props> = ({ scanner, title, description, icon }) => {
  return (
    <Link to={`/trivy/${scanner}`} style={{ textDecoration: 'none' }}>
      <Card >
        <Stack direction="column" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Icon name={icon} size={22} />
            <Text weight='semibold' size='lg'>{title}</Text>
          </Stack>
          <Text size='sm'>{description}</Text>
        </Stack>
        <Box sx={{ display: 'flex', flexDirection: 'row', p: 2 }}>
          <Button
            fullWidth
            emphasis="solid"
            size="md"
            color="primary"
            aria-label="Explore Bahamas Islands"
            sx={{ alignSelf: 'center', fontWeight: 600 }}
          >
          Scan Now
          </Button>
        </Box>
      </Card>
    </Link>
  );
};

export default TrivyReportCard;
