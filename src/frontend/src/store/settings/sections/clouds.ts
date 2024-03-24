import { type SettingsSection } from '../types';

export const awsState: SettingsSection = {
  id: 'aws',
  label: 'AWS',
  description: 'Customize the AWS settings',
  icon: 'SiAmazonaws',
  settings: {},
};

export const azureState: SettingsSection = {
  id: 'azure',
  label: 'Azure',
  description: 'Customize the Azure settings',
  icon: 'SiMicrosoftazure',
  settings: {},
};

export const gcpState: SettingsSection = {
  id: 'gcp',
  label: 'GCP',
  description: 'Customize the GCP settings',
  icon: 'SiGooglecloud',
  settings: {},
};

