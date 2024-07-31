import * as React from 'react';

// material-ui
import Button from '@mui/joy/Button';
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import Typography from '@mui/joy/Typography';
import Stack from '@mui/joy/Stack';
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
            <Typography level="title-lg">{title}</Typography>
          </Stack>
          <Typography level="body-sm">{description}</Typography>
        </Stack>
        <CardContent orientation="horizontal">
          <Button
            fullWidth
            variant="solid"
            size="md"
            color="primary"
            aria-label="Explore Bahamas Islands"
            sx={{ alignSelf: 'center', fontWeight: 600 }}
          >
          Scan Now
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
};

export default TrivyReportCard;
