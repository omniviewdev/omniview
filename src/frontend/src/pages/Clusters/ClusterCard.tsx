// Import { FC } from 'react';
// import { usePluginRouter } from '@infraview/router';
//
// import AspectRatio from '@mui/joy/AspectRatio';
// import Card from '@mui/joy/Card';
// import CardContent from '@mui/joy/CardContent';
// import Chip from '@mui/joy/Chip';
// import Typography from '@mui/joy/Typography';
// import { IconButton, Stack } from '@mui/joy';
// import { useColorScheme } from '@mui/joy/styles';
//
// import { clusters } from 'wailsjs/go/models'
// import { MoreHoriz } from '@mui/icons-material';
// import { useDispatch } from 'react-redux';
// import { handleAddTab } from '@/store/tabs/slice';
//
// const getDistributionImage = (distribution: string) => {
//   let distro = distribution.toLowerCase();
//
//   switch (distro) {
//     case 'k3s':
//       return 'https://store.cncf.io/cdn/shop/collections/K3S.png?v=1619635176';
//     case 'minikube':
//       return 'https://miro.medium.com/v2/resize:fit:400/0*KzqL3xqmXzV5PPjX.png';
//     case 'eks':
//       return 'https://yt3.googleusercontent.com/HRJKaJg70sqBrCNh7Tf2RSjXTb_5hCUn7Hht7mxUJMg77EWkihh55JklD-KhwAMhwY31ox5O=s900-c-k-c0x00ffffff-no-rj';
//     case 'k8s':
//       return 'https://static-00.iconduck.com/assets.00/kubernetes-icon-2048x1995-r1q3f8n7.png';
//     default:
//       return 'https://kubernetes.io/images/kubernetes-horizontal-color.png';
//   }
// }
//
// const getClusterShortName = (name: string, _distribution: string) => {
//   // todo
//   return name;
// }
//
// const ClusterCard: FC<clusters.ClusterInfo> = ({ name, version, description, kubeconfig, distribution, region }) => {
//   const { mode } = useColorScheme();
//   const { navigate } = usePluginRouter();
//   const dispatch = useDispatch();
//
//
//   const handleSelectCluster = async (kubeconfig: string, name: string, icon: string) => {
//     const contextID = `${kubeconfig}:${name}`;
//
//     dispatch(handleAddTab({ cluster: contextID, label: name, icon: icon }))
//     // switch the context in the backend to the selected cluster
//     navigate('/connecting', { toContext: contextID });
//   }
//
//   return (
//     <Card
//       variant="outlined"
//       orientation="horizontal"
//       sx={{
//         '&:hover': {
//           boxShadow: 'rgba(149, 157, 165, 0.2) 0px 8px 24px',
//           borderColor: mode === "dark" ? 'white' : 'darkgray',
//           cursor: 'pointer',
//         },
//       }}
//       onClick={() => handleSelectCluster(kubeconfig, name, getDistributionImage(distribution))}
//     >
//       <AspectRatio ratio="1" sx={{ width: 54, height: 54 }}>
//         <img
//           src={getDistributionImage(distribution)}
//           srcSet={getDistributionImage(distribution)}
//           loading="lazy"
//           alt={name}
//         />
//       </AspectRatio>
//       <CardContent sx={{ width: '100%' }} >
//         <Stack direction="row" spacing={1} justifyContent={'space-between'} alignItems={'center'}>
//           <Typography level="title-md" id="cluster-name" noWrap textOverflow={'ellipsis'}>
//             {getClusterShortName(name, distribution)}
//           </Typography>
//           {/* More button */}
//           <IconButton variant="soft" size='sm'>
//             <MoreHoriz />
//           </IconButton>
//           {version &&
//             <Chip
//               variant="outlined"
//               color="primary"
//               size="sm"
//               sx={{ pointerEvents: 'none' }}
//             >
//               {version}
//             </Chip>
//           }
//         </Stack>
//         {description &&
//           <Typography level="body-sm" aria-describedby="cluster-description" mb={1} noWrap>
//
//             {description}
//           </Typography>
//         }
//         <Stack direction="row" spacing={1} alignItems={'flex-end'}>
//           {region && <Chip variant='soft' color="neutral" size="sm" sx={{ pointerEvents: 'none' }}>{region}</Chip>}
//           <Chip
//             variant="outlined"
//             color="primary"
//             size="sm"
//             sx={{ pointerEvents: 'none' }}
//           >
//             {distribution}
//           </Chip>
//           <Chip variant="outlined" color="primary" size="sm" sx={{ pointerEvents: 'none' }}>
//             {kubeconfig}
//           </Chip>
//         </Stack>
//       </CardContent>
//     </Card >
//   );
// }
//
// export default ClusterCard;
