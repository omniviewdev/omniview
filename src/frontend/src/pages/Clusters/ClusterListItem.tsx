import React from 'react'

// state
import { useDispatch } from 'react-redux';
import { handleAddTab } from '@/store/tabs/slice';

// material-ui
import Avatar from '@mui/joy/Avatar';
import Chip from '@mui/joy/Chip';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

// types
import { clusters } from '@api/models'
import { usePluginRouter } from '@infraview/router';
import Icon from '@/components/icons/Icon';

type Props = clusters.ClusterInfo

const ClusterListItem: React.FC<Props> = ({ name, version, description, kubeconfig, distribution, region }) => {
  const { navigate } = usePluginRouter();
  const dispatch = useDispatch();


  /**
   * Navigate to the cluster view and set the context to the selected cluster. Since we're setting
  */
  const handleSelectCluster = async (kubeconfig: string, name: string, icon: string) => {
    const contextID = `${kubeconfig}:${name}`;

    dispatch(handleAddTab({ cluster: contextID, label: name, icon: icon }))

    // switch the context in the backend to the selected cluster
    navigate('/connecting', { toContext: contextID });
  }

  return (
    <ListItemButton onClick={() => handleSelectCluster(kubeconfig, name, getDistributionImage(distribution))}>
      <ListItemDecorator>
        <Avatar size="sm" src={getDistributionImage(distribution)} sx={{ borderRadius: 6, backgroundColor: 'transparent', objectFit: 'contain', border: 0 }} />
      </ListItemDecorator>
      <Stack direction="row" width={'100%'}>
        <Stack direction="column" width={'100%'}>
          <Typography level="title-md" noWrap>{name}</Typography>
          {!!description && <Typography level="body-sm" noWrap>{description}</Typography>}
        </Stack>

        <Stack direction="row" spacing={1} alignItems={'flex-end'}>
          {version && <Chip variant='soft' color="neutral" size="sm" sx={{ pointerEvents: 'none' }}>{version}</Chip>}
          {region && <Chip variant='soft' color="neutral" size="sm" sx={{ pointerEvents: 'none' }} startDecorator={getRegionDecorator(distribution, region)}>{region}</Chip>}
          <Chip
            variant="outlined"
            color="primary"
            size="sm"
            sx={{ pointerEvents: 'none' }}
          >
            {distribution}
          </Chip>
          <Chip variant="outlined" color="primary" size="sm" sx={{ pointerEvents: 'none' }}>
            {kubeconfig}
          </Chip>
        </Stack>
      </Stack>
    </ListItemButton>
  )
}

// =================================================== HELPERS (TODO - MOVE OUT) =================================================== //

const getDistributionImage = (distribution: string) => {
  let distro = distribution.toLowerCase();

  switch (distro) {
    case 'k3s':
      return 'https://store.cncf.io/cdn/shop/collections/K3S.png?v=1619635176';
    case 'minikube':
      return 'https://miro.medium.com/v2/resize:fit:400/0*KzqL3xqmXzV5PPjX.png';
    case 'eks':
      return 'https://yt3.googleusercontent.com/HRJKaJg70sqBrCNh7Tf2RSjXTb_5hCUn7Hht7mxUJMg77EWkihh55JklD-KhwAMhwY31ox5O=s900-c-k-c0x00ffffff-no-rj';
    case 'k8s':
      return 'https://static-00.iconduck.com/assets.00/kubernetes-icon-2048x1995-r1q3f8n7.png';
    default:
      return 'https://kubernetes.io/images/kubernetes-horizontal-color.png';
  }
}

const getRegionDecorator = (distribution: string, _region: string) => {
  let distro = distribution.toLowerCase();
  if (distro === 'eks') {
    return <Icon name="SiAmazonaws" />
  }
  return <></>;
}

export default ClusterListItem;
