import React from 'react';
import { Button } from '@omniviewdev/base-ui';
import SectionCard from '../ui/SectionCard';

type Props = {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  /** Show a danger-styled action button (e.g., for delete operations) */
  dangerAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
  };
};

const FormSection: React.FC<Props> = ({
  title,
  icon,
  description,
  children,
  onSave,
  onReset,
  dirty,
  saving,
  dangerAction,
}) => {
  return (
    <SectionCard
      title={title}
      icon={icon}
      description={description}
      actions={
        <>
          {dangerAction && (
            <Button
              size='sm'
              variant='soft'
              color='danger'
              onClick={dangerAction.onClick}
            >
              {dangerAction.loading ? 'Loading...' : dangerAction.label}
            </Button>
          )}
          {onReset && (
            <Button size='sm' variant='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
              Reset
            </Button>
          )}
          {onSave && (
            <Button size='sm' variant='soft' color='brand' disabled={!dirty || saving} onClick={onSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </>
      }
      bodyPadding={12}
    >
      {children}
    </SectionCard>
  );
};

export default FormSection;
