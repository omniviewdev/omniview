import * as React from 'react';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Card from '@mui/joy/Card';
import CardContent from '@mui/joy/CardContent';
import CardActions from '@mui/joy/CardActions';
import Chip from '@mui/joy/Chip';
import IconButton from '@mui/joy/IconButton';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// types
import { types } from '@api/models';
import Icon from '@/components/icons/Icon';
import { FaGithub } from 'react-icons/fa6';

type Props = Partial<types.Plugin>;

const InstalledPluginCard: React.FC<Props> = ({ id, metadata }) => {
  return (
    <Card
      id={`plugin-card-${id}`}
      variant="outlined"
      sx={{
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography level="title-lg">{metadata?.name}</Typography>
          <Chip size="sm" sx={{ borderRadius: 'sm', maxHeight: 20 }} color="primary">
            {metadata?.version}
          </Chip>
        </Stack>
        {metadata?.icon.endsWith('.svg') || metadata?.icon.endsWith('.png') ? (
          <Avatar
            size="md"
            src={metadata.icon}
            variant='plain'
            sx={{ borderRadius: 4, position: 'absolute', top: 10, right: 10 }} />
        ) : <Icon name={metadata?.icon || ''} size={44} />}
      </Box>
      <CardContent>
        <Typography level="body-sm">{metadata?.description}</Typography>
      </CardContent>
      <CardActions buttonFlex="0 1 120px">
        <IconButton variant="outlined" color="neutral" sx={{ mr: 'auto' }}>
          <FaGithub />
        </IconButton>
        <Button variant="outlined" color="neutral">
          View
        </Button>
        <Button variant="solid" color="primary">
          Uninstall
        </Button>
      </CardActions>
    </Card>
  );
}

export default InstalledPluginCard;
