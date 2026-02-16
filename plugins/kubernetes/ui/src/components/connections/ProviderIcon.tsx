import React from 'react';
import {
  SiKubernetes,
  SiAmazonwebservices,
  SiGooglecloud,
} from 'react-icons/si';
import { VscAzure } from 'react-icons/vsc';
import { LuContainer, LuBox, LuServer } from 'react-icons/lu';
import { getProviderColor } from '../../utils/providers';

type Props = {
  provider: string;
  size?: number;
};

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  eks: SiAmazonwebservices,
  gke: SiGooglecloud,
  aks: VscAzure,
  kind: LuBox,
  minikube: SiKubernetes,
  'docker-desktop': LuContainer,
  k3d: LuBox,
  k3s: LuServer,
  openshift: SiKubernetes,
  rancher: SiKubernetes,
  generic: SiKubernetes,
};

const ProviderIcon: React.FC<Props> = ({ provider, size = 18 }) => {
  const Icon = iconMap[provider] ?? SiKubernetes;
  const color = getProviderColor(provider);
  return <Icon size={size} color={color} />;
};

export default ProviderIcon;
