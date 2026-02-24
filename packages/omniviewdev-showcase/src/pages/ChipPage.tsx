import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuStar, LuShield, LuZap, LuCircleCheck, LuBug, LuX } from 'react-icons/lu';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import VariantMatrix from '../helpers/VariantMatrix';
import Chip from '@omniviewdev/ui/components/Chip';
import type { SemanticColor, Emphasis, ComponentSize, Shape } from '@omniviewdev/ui/types';

const COLORS: SemanticColor[] = ['primary', 'secondary', 'success', 'warning', 'error', 'info', 'neutral', 'accent', 'danger', 'muted'];
const EMPHASES: Emphasis[] = ['solid', 'soft', 'outline', 'ghost'];
const SIZES: ComponentSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const SHAPES: Shape[] = ['pill', 'rounded', 'square'];

export default function ChipPage() {
  const [deletedChips, setDeletedChips] = useState<Set<string>>(new Set());

  const handleDelete = (id: string) => {
    setDeletedChips((prev) => new Set(prev).add(id));
  };

  const resetDeleted = () => setDeletedChips(new Set());

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: '32px' }}>
        Chip
      </Typography>

      <Section title="Chip" description="Compact element for tags, labels, statuses, and filters. Supports semantic colors, emphasis levels, shapes, sizes, icons, deletable state, and text transformations.">
        <ImportStatement code="import { Chip } from '@omniviewdev/ui';" />

        {/* ---------------------------------------------------------------- */}
        {/* Color × Emphasis Matrix                                          */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Color × Emphasis Matrix" description="All semantic colors across each emphasis level.">
          <VariantMatrix
            rows={COLORS}
            columns={EMPHASES}
            rowLabel="Color"
            columnLabel="Emphasis"
            renderCell={(color, emphasis) => (
              <Chip label={color} color={color} emphasis={emphasis} size="sm" />
            )}
          />
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Sizes                                                            */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Sizes" description="xs through xl. All five ComponentSize values are supported.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {SIZES.map((s) => (
              <Chip key={s} label={s.toUpperCase()} color="primary" emphasis="soft" size={s} />
            ))}
          </Box>
          <Box sx={{ mt: 2, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {SIZES.map((s) => (
              <Chip key={s} label={s.toUpperCase()} color="primary" emphasis="solid" size={s} />
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Shapes                                                           */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Shapes" description="pill (default MUI), rounded (6px radius), and square (0px radius).">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {SHAPES.map((shape) => (
              <Chip key={shape} label={shape} color="info" emphasis="soft" shape={shape} />
            ))}
          </Box>
          <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {SHAPES.map((shape) => (
              <Chip key={shape} label={shape} color="success" emphasis="solid" shape={shape} />
            ))}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* With Icons                                                       */}
        {/* ---------------------------------------------------------------- */}
        <Example title="With Icons" description="Icons render to the left of the label via the icon prop.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="Starred" icon={<LuStar size={14} />} color="warning" emphasis="soft" />
            <Chip label="Secure" icon={<LuShield size={14} />} color="success" emphasis="soft" />
            <Chip label="Fast" icon={<LuZap size={14} />} color="accent" emphasis="soft" />
            <Chip label="Passed" icon={<LuCircleCheck size={14} />} color="success" emphasis="solid" />
            <Chip label="Bug" icon={<LuBug size={14} />} color="error" emphasis="outline" />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Text Transformations                                             */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Text Transformations" description="The textTransform prop controls CSS text-transform on the label.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="uppercase" color="primary" emphasis="soft" textTransform="uppercase" />
            <Chip label="Capitalize" color="info" emphasis="soft" textTransform="capitalize" />
            <Chip label="LOWERCASE" color="warning" emphasis="soft" textTransform="lowercase" />
            <Chip label="Default" color="neutral" emphasis="soft" />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Clickable                                                        */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Clickable" description="Chips with onClick get hover/focus styles and pointer cursor.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="Click me" color="primary" emphasis="soft" onClick={() => alert('Clicked!')} />
            <Chip label="Filter: Active" color="success" emphasis="outline" onClick={() => {}} />
            <Chip label="Tag: v2.1.0" color="info" emphasis="soft" shape="rounded" onClick={() => {}} />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Deletable                                                        */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Deletable" description="Chips with deletable or onDelete show a delete icon. Click the × to dismiss.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            {['frontend', 'backend', 'devops', 'design'].map((tag) =>
              !deletedChips.has(tag) ? (
                <Chip
                  key={tag}
                  label={tag}
                  color="primary"
                  emphasis="soft"
                  onDelete={() => handleDelete(tag)}
                />
              ) : null
            )}
            {deletedChips.size > 0 && (
              <Chip label="Reset" color="neutral" emphasis="ghost" icon={<LuX size={12} />} onClick={resetDeleted} />
            )}
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Disabled                                                         */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Disabled" description="Disabled chips are visually muted and non-interactive.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="Solid" color="primary" emphasis="solid" disabled />
            <Chip label="Soft" color="primary" emphasis="soft" disabled />
            <Chip label="Outline" color="primary" emphasis="outline" disabled />
            <Chip label="Ghost" color="primary" emphasis="ghost" disabled />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Status Badges                                                    */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Status Badges" description="Soft emphasis chips with icons make great status indicators. Use shape='rounded' for a rectangular feel, uppercase text for emphasis.">
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="Ready" color="success" emphasis="soft" shape="rounded" textTransform="uppercase" size="xs" />
            <Chip label="Building" color="warning" emphasis="soft" shape="rounded" textTransform="uppercase" size="xs" />
            <Chip label="Error" color="error" emphasis="soft" shape="rounded" textTransform="uppercase" size="xs" />
            <Chip label="Pending" color="info" emphasis="soft" shape="rounded" textTransform="uppercase" size="xs" />
            <Chip label="Stopped" color="neutral" emphasis="soft" shape="rounded" textTransform="uppercase" size="xs" />
          </Box>
          <Box sx={{ mt: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="Healthy" color="success" emphasis="soft" shape="pill" size="sm" icon={<LuCircleCheck size={12} />} />
            <Chip label="Warning" color="warning" emphasis="soft" shape="pill" size="sm" icon={<LuZap size={12} />} />
            <Chip label="Critical" color="danger" emphasis="soft" shape="pill" size="sm" icon={<LuBug size={12} />} />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Real-World: Kubernetes Labels                                     */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Real-World: Kubernetes Labels" description="Common pattern for displaying Kubernetes labels and annotations as chip lists.">
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label="app=nginx" color="primary" emphasis="soft" shape="rounded" size="xs" />
            <Chip label="env=production" color="error" emphasis="soft" shape="rounded" size="xs" />
            <Chip label="tier=frontend" color="info" emphasis="soft" shape="rounded" size="xs" />
            <Chip label="version=v2.1.0" color="neutral" emphasis="outline" shape="rounded" size="xs" />
          </Box>
        </Example>

        {/* ---------------------------------------------------------------- */}
        {/* Composition: Filter Bar                                          */}
        {/* ---------------------------------------------------------------- */}
        <Example title="Composition: Filter Bar" description="Deletable chips in a filter bar pattern.">
          <Box
            sx={{
              display: 'flex',
              gap: 0.75,
              alignItems: 'center',
              flexWrap: 'wrap',
              p: 1,
              bgcolor: 'var(--ov-bg-surface-inset)',
              borderRadius: 'var(--ov-radius-md)',
              border: '1px solid var(--ov-border-default)',
            }}
          >
            <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', mr: 0.5 }}>Filters:</Typography>
            <Chip label="Namespace: default" color="primary" emphasis="soft" shape="rounded" size="xs" onDelete={() => {}} />
            <Chip label="Status: Running" color="success" emphasis="soft" shape="rounded" size="xs" onDelete={() => {}} />
            <Chip label="Type: Deployment" color="info" emphasis="soft" shape="rounded" size="xs" onDelete={() => {}} />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
