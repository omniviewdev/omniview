import ClearIcon from '@mui/icons-material/Clear';
import { Button, Input, Stack, Select, Option, ToggleButtonGroup, IconButton } from '@mui/joy';
import React from 'react';

import { trivy } from '@api/models';
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
    newValue: trivy.Command | null,
  ) => {
    if (newValue) {
      setTarget(newValue);
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
        backgroundColor: (theme) => theme.palette.background.surface,
      }}
    >
      <Select
        size='sm'
        sx={{
          boxShadow: 'none',
          minWidth: 200,
        }}
        value={target}
        onChange={handleChangeTarget}
        startDecorator={getDecorator()}
      >
        <Option value={trivy.Command.IMAGE}>
          <LuContainer />
          Image
        </Option>
        <Option value={trivy.Command.FILESYSTEM}>
          <LuFileScan />
          Filesystem
        </Option>
        <Option value={trivy.Command.KUBERNETES}>
          <SiKubernetes />
          Kubernetes
        </Option>
        <Option value={trivy.Command.SBOM}>
          <LuFileText />
          SBOM
        </Option>
      </Select>

      <Input
        size='sm'
        fullWidth
        variant='outlined'
        autoComplete='off'
        type='text'
        placeholder={'Specify a target'}
        endDecorator={value ? (
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
        slotProps={{
          input: {
            // Keep the input from auto capitalizing and autocorrecting, doesn't work
            // without both the input and the inputProps
            autoCorrect: 'off',
            autoComplete: 'off',
          },
        }}
      />
      <ToggleButtonGroup
        size='sm'
        value={scanners}
        onChange={(_, newValue) => {
          setScanners(newValue);
        }}
      >
        <Button color={'primary'} value={trivy.Scanner.VULN}>Vulnerability</Button>
        <Button color={'primary'} value={trivy.Scanner.SECRET}>Secret</Button>
        <Button color={'primary'} value={trivy.Scanner.MISCONFIG}>Misconfiguration</Button>
        <Button color={'primary'} value={trivy.Scanner.LICENSE}>License</Button>
      </ToggleButtonGroup>
      <Button
        size='sm'
        variant='solid'
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
