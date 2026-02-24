import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';
import VariantMatrix from '../helpers/VariantMatrix';

import { Button, IconButton, CopyButton, ConfirmButton, ActionMenu, ButtonGroup } from '@omniviewdev/ui/buttons';
import type { SemanticColor, Emphasis, ComponentSize } from '@omniviewdev/ui/types';

const colors: SemanticColor[] = ['primary', 'secondary', 'success', 'warning', 'error', 'info', 'neutral', 'accent', 'danger', 'muted'];
const emphases: Emphasis[] = ['solid', 'soft', 'outline', 'ghost', 'link'];
const sizes: ComponentSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

export default function ButtonPage() {
  const [confirmCount, setConfirmCount] = useState(0);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}
      >
        Buttons
      </Typography>

      {/* ---- Button ---- */}
      <Section
        title="Button"
        description="Primary button component with consistent color, emphasis, and size API. Wraps MUI Button."
      >
        <ImportStatement code="import { Button } from '@omniviewdev/ui/buttons';" />

        <Example title="Color x Emphasis Matrix">
          <VariantMatrix
            rows={colors}
            columns={emphases}
            rowLabel="Color"
            columnLabel="Emphasis"
            renderCell={(color, emphasis) => (
              <Button color={color} emphasis={emphasis} size="sm">
                {color}
              </Button>
            )}
          />
        </Example>

        <Example title="Sizes" description="All five size options: xs, sm, md, lg, xl.">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {sizes.map((size) => (
              <Button key={size} size={size} emphasis="outline" color="primary">
                {size}
              </Button>
            ))}
          </Box>
        </Example>

        <Example title="Loading states">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button emphasis="solid" color="primary" loading>Loading</Button>
            <Button emphasis="outline" color="primary" loading loadingPosition="start" startIcon={<DownloadIcon />}>
              Downloading
            </Button>
            <Button emphasis="soft" color="success" loading loadingPosition="end" endIcon={<DownloadIcon />}>
              Saving
            </Button>
          </Box>
        </Example>

        <Example title="With icons">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button emphasis="solid" color="primary" startIcon={<AddIcon />}>Create</Button>
            <Button emphasis="outline" color="danger" startIcon={<DeleteIcon />}>Delete</Button>
            <Button emphasis="ghost" color="neutral" endIcon={<EditIcon />}>Edit</Button>
          </Box>
        </Example>

        <Example title="Shapes">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button emphasis="solid" color="primary" shape="rounded">Rounded</Button>
            <Button emphasis="solid" color="primary" shape="pill">Pill</Button>
            <Button emphasis="solid" color="primary" shape="square">Square</Button>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'color', type: 'SemanticColor', default: '"neutral"', description: 'Color theme.' },
            { name: 'emphasis', type: 'Emphasis', default: '"ghost"', description: 'Visual weight (solid, soft, outline, ghost, link).' },
            { name: 'size', type: 'ComponentSize', default: '"sm"', description: 'Button size (xs, sm, md, lg, xl).' },
            { name: 'shape', type: 'Shape', default: '"rounded"', description: 'Border radius preset.' },
            { name: 'loading', type: 'boolean', default: 'false', description: 'Show loading spinner.' },
            { name: 'loadingPosition', type: '"start" | "center" | "end"', default: '"center"', description: 'Where to show spinner.' },
            { name: 'startIcon', type: 'ReactNode', description: 'Icon before text.' },
            { name: 'endIcon', type: 'ReactNode', description: 'Icon after text.' },
            { name: 'disabled', type: 'boolean', description: 'Disable the button.' },
            { name: 'fullWidth', type: 'boolean', description: 'Stretch to container width.' },
          ]}
        />
      </Section>

      {/* ---- IconButton ---- */}
      <Section
        title="IconButton"
        description="Icon-only button with consistent sizing and shape."
      >
        <ImportStatement code="import { IconButton } from '@omniviewdev/ui/buttons';" />

        <Example title="Sizes and shapes">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {sizes.map((size) => (
              <IconButton key={size} size={size} color="primary">
                <EditIcon fontSize="inherit" />
              </IconButton>
            ))}
            <Box sx={{ mx: 1, borderLeft: '1px solid var(--ov-border-default)', height: 32 }} />
            <IconButton shape="pill" color="success"><AddIcon fontSize="inherit" /></IconButton>
            <IconButton shape="square" color="danger"><DeleteIcon fontSize="inherit" /></IconButton>
          </Box>
        </Example>
      </Section>

      {/* ---- CopyButton ---- */}
      <Section
        title="CopyButton"
        description="Copies a value to clipboard with check icon feedback."
      >
        <ImportStatement code="import { CopyButton } from '@omniviewdev/ui/buttons';" />

        <Example title="Default">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" sx={{ fontFamily: 'var(--ov-font-mono)', color: 'var(--ov-fg-default)' }}>
              kubectl get pods
            </Typography>
            <CopyButton value="kubectl get pods" />
          </Box>
        </Example>
      </Section>

      {/* ---- ConfirmButton ---- */}
      <Section
        title="ConfirmButton"
        description="Button with popover confirmation dialog. Useful for destructive actions."
      >
        <ImportStatement code="import { ConfirmButton } from '@omniviewdev/ui/buttons';" />

        <Example title="Default">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ConfirmButton
              emphasis="outline"
              color="danger"
              startIcon={<DeleteIcon />}
              onConfirm={() => setConfirmCount((c) => c + 1)}
            >
              Delete resource
            </ConfirmButton>
            <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)' }}>
              Confirmed {confirmCount} time(s)
            </Typography>
          </Box>
        </Example>
      </Section>

      {/* ---- ActionMenu ---- */}
      <Section
        title="ActionMenu"
        description="Kebab/dot menu with configurable action items."
      >
        <ImportStatement code="import { ActionMenu } from '@omniviewdev/ui/buttons';" />

        <Example title="Default trigger">
          <ActionMenu
            items={[
              { key: 'edit', label: 'Edit', icon: <EditIcon fontSize="small" />, onClick: () => {} },
              { key: 'download', label: 'Download', icon: <DownloadIcon fontSize="small" />, onClick: () => {}, dividerAfter: true },
              { key: 'delete', label: 'Delete', icon: <DeleteIcon fontSize="small" />, color: 'danger', onClick: () => {} },
            ]}
          />
        </Example>
      </Section>

      {/* ---- ButtonGroup ---- */}
      <Section
        title="ButtonGroup"
        description="Group of related buttons with shared emphasis and size."
      >
        <ImportStatement code="import { ButtonGroup } from '@omniviewdev/ui/buttons';" />

        <Example title="Emphasis variants">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(['outline', 'solid', 'ghost'] as const).map((emp) => (
              <ButtonGroup key={emp} emphasis={emp} color="primary">
                <Button emphasis={emp} color="primary">One</Button>
                <Button emphasis={emp} color="primary">Two</Button>
                <Button emphasis={emp} color="primary">Three</Button>
              </ButtonGroup>
            ))}
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
