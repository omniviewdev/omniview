import ClearIcon from '@mui/icons-material/Clear';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import { TextField, Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import Box from '@mui/material/Box';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import React from 'react';

import { trivy } from '@omniviewdev/runtime/models';
import { LuContainer, LuFileScan, LuFileText } from 'react-icons/lu';
import { SiKubernetes } from 'react-icons/si';

type Props = {
  scan: (target: trivy.Command, value: string, scanners: trivy.Scanner[]) => void;
  isScanning: boolean;
};

const TrivyScanHeader: React.FC<Props> = ({
  scan,
  isScanning,
}) => {
  const [value, onChange] = React.useState('');
  const [target, setTarget] = React.useState<trivy.Command>(trivy.Command.IMAGE);
  const [scanners, setScanners] = React.useState<trivy.Scanner[]>([trivy.Scanner.VULN, trivy.Scanner.SECRET]);

  const handleClear = () => {
    onChange('');
  };

  const handleChangeTarget = (
    _event: React.SyntheticEvent | null,
    newValue: string | null,
  ) => {
    if (newValue) {
      setTarget(newValue as trivy.Command);
    }
  };

  const getDecorator = () => {
    switch (target) {
      case trivy.Command.IMAGE:
        return <LuContainer />;
      case trivy.Command.FILESYSTEM:
        return <LuFileScan />;
      case trivy.Command.KUBERNETES:
        return <SiKubernetes />;
      case trivy.Command.SBOM:
        return <LuFileText />;
      default:
        return null;
    }
  };

  return (
    <Stack
      direction='row'
      alignItems='center'
      gap={1.5}
      p={1}
      sx={{
        backgroundColor: (theme) => theme.palette.background.paper,
      }}
    >
      <Select
        size='sm'
        value={target}
        onChange={(e) => handleChangeTarget(null, e.target.value)}
        startAdornment={getDecorator()}
        options={[
          { value: trivy.Command.IMAGE, label: 'Image' },
          { value: trivy.Command.FILESYSTEM, label: 'Filesystem' },
          { value: trivy.Command.KUBERNETES, label: 'Kubernetes' },
          { value: trivy.Command.SBOM, label: 'SBOM' },
        ]}
        sx={{
          boxShadow: 'none',
          minWidth: 200,
        }}
      />

      <TextField
        size='sm'
        fullWidth
        autoComplete='off'
        type='text'
        placeholder={'Specify a target'}
        endAdornment={value ? (
          <IconButton
            sx={{ padding: 0 }}
            onClick={handleClear}
          >
            <ClearIcon fontSize='small' />
          </IconButton>

        ) : undefined}
        value={value}
        onChange={e => {
          onChange(e.target.value);
        }}
        sx={{
          display: 'flex',
          boxShadow: 'none',
          minWidth: {
            md: 400,
            lg: 400,
            xl: 500,
          },
          '--wails-draggable': 'no-drag',
        }}
      />
      <ToggleButtonGroup
        size='small'
        value={scanners}
        onChange={(_, newValue) => {
          setScanners(newValue);
        }}
      >
        <ToggleButton color='primary' value={trivy.Scanner.VULN}>Vulnerability</ToggleButton>
        <ToggleButton color='primary' value={trivy.Scanner.SECRET}>Secret</ToggleButton>
        <ToggleButton color='primary' value={trivy.Scanner.MISCONFIG}>Misconfiguration</ToggleButton>
        <ToggleButton color='primary' value={trivy.Scanner.LICENSE}>License</ToggleButton>
      </ToggleButtonGroup>
      <Button
        size='sm'
        emphasis='solid'
        sx={{
          minWidth: 100,
        }}
        onClick={() => {
          scan(target, value, scanners);
        }}
        disabled={isScanning}
      >
        Scan
      </Button>
    </Stack>
  );
};

export default TrivyScanHeader;
