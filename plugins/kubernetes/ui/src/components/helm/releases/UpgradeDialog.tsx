import React from 'react';

// material-ui
import Box from '@mui/material/Box';
import Modal from '@mui/material/Modal';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// project-imports
import { useExecuteAction } from '@omniviewdev/runtime';
import CodeEditor from '../../shared/CodeEditor';
import { stringify } from 'yaml';

interface Props {
  open: boolean;
  onClose: () => void;
  releaseName: string;
  namespace: string;
  chartRef: string;
  connectionID: string;
}

const modalStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '80%',
  maxWidth: 800,
  maxHeight: '85vh',
  bgcolor: 'background.paper',
  borderRadius: 2,
  boxShadow: 24,
  p: 3,
  overflow: 'auto',
};

const UpgradeDialog: React.FC<Props> = ({ open, onClose, releaseName, namespace, chartRef, connectionID }) => {
  const [values, setValues] = React.useState('');
  const [reuseValues, setReuseValues] = React.useState(true);
  const [dryRunManifest, setDryRunManifest] = React.useState<string | null>(null);
  const [valuesLoaded, setValuesLoaded] = React.useState(false);

  const { executeAction, isExecuting } = useExecuteAction({
    pluginID: 'kubernetes',
    connectionID,
    resourceKey: 'helm::v1::Release',
  });

  // Load current values on open
  React.useEffect(() => {
    if (!open || !releaseName || valuesLoaded) return;

    void executeAction({
      actionID: 'get-values',
      id: releaseName,
      namespace,
      params: { all: true },
    }).then((result) => {
      setValues(result.data ? stringify(result.data) : '');
      setValuesLoaded(true);
    }).catch(() => {
      setValuesLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, releaseName]);

  const handleDryRun = async () => {
    try {
      const result = await executeAction({
        actionID: 'dry-run-upgrade',
        id: releaseName,
        namespace,
        params: {
          chart: chartRef,
          reuse_values: reuseValues,
        },
      });
      setDryRunManifest(result.data?.manifest ?? 'No manifest generated');
    } catch (err: any) {
      setDryRunManifest(`Error: ${err?.message ?? 'Dry run failed'}`);
    }
  };

  const handleUpgrade = async () => {
    try {
      await executeAction({
        actionID: 'upgrade',
        id: releaseName,
        namespace,
        params: {
          chart: chartRef,
          reuse_values: reuseValues,
        },
      });
      onClose();
    } catch {
      // Error handling is done by the runtime
    }
  };

  const handleClose = () => {
    setDryRunManifest(null);
    setValuesLoaded(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <Box sx={modalStyle}>
        <Stack direction="column" spacing={2}>
          <Text weight="semibold" size="lg">Upgrade {releaseName}</Text>

          {/* Options */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Box
              component="label"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
            >
              <Box
                component="input"
                type="checkbox"
                checked={reuseValues}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReuseValues(e.target.checked)}
              />
              <Text size="sm">Reuse existing values</Text>
            </Box>
          </Stack>

          {/* Values editor */}
          <Stack direction="column" spacing={0.5}>
            <Text size="sm" sx={{ color: 'neutral.400' }}>Values (YAML)</Text>
            <Box sx={{ height: 250, border: '1px solid', borderColor: 'neutral.700', borderRadius: 'sm', overflow: 'hidden' }}>
              <CodeEditor
                filename="values.yaml"
                language="yaml"
                value={values}
                onChange={(v) => setValues(v)}
                height={250}
              />
            </Box>
          </Stack>

          {/* Dry run preview */}
          {dryRunManifest !== null && (
            <Stack direction="column" spacing={0.5}>
              <Text size="sm" sx={{ color: 'neutral.400' }}>Dry Run Preview</Text>
              <Box sx={{ height: 200, border: '1px solid', borderColor: 'neutral.700', borderRadius: 'sm', overflow: 'hidden' }}>
                <CodeEditor
                  filename="manifest.yaml"
                  language="yaml"
                  value={dryRunManifest}
                  readOnly
                  height={200}
                />
              </Box>
            </Stack>
          )}

          {/* Action buttons */}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="sm" emphasis="outline" color="neutral" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              emphasis="outline"
              color="neutral"
              disabled={isExecuting}
              onClick={() => void handleDryRun()}
            >
              Dry Run
            </Button>
            <Button
              size="sm"
              emphasis="solid"
              color="primary"
              disabled={isExecuting}
              onClick={() => void handleUpgrade()}
            >
              Upgrade
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Modal>
  );
};

export default UpgradeDialog;
