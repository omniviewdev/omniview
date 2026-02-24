import React from 'react';
import { Box, Typography, Button, ButtonGroup } from '@mui/material';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import { resetTheme } from '../../theme';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const grayScale = Array.from({ length: 14 }, (_, i) => ({
  token: `--ov-scale-gray-${i}`,
  index: i,
}));

const bgTokens = [
  { token: '--ov-bg-base', label: 'base' },
  { token: '--ov-bg-surface', label: 'surface' },
  { token: '--ov-bg-surface-raised', label: 'raised' },
  { token: '--ov-bg-surface-overlay', label: 'overlay' },
  { token: '--ov-bg-surface-inset', label: 'inset' },
];

const fgTokens = [
  { token: '--ov-fg-base', label: 'base' },
  { token: '--ov-fg-default', label: 'default' },
  { token: '--ov-fg-muted', label: 'muted' },
  { token: '--ov-fg-faint', label: 'faint' },
  { token: '--ov-fg-disabled', label: 'disabled' },
  { token: '--ov-fg-accent', label: 'accent' },
];

const borderTokens = [
  { token: '--ov-border-default', label: 'default' },
  { token: '--ov-border-muted', label: 'muted' },
  { token: '--ov-border-emphasis', label: 'emphasis' },
];

const accentTokens = [
  { token: '--ov-accent', label: 'accent' },
  { token: '--ov-accent-muted', label: 'muted' },
  { token: '--ov-accent-subtle', label: 'subtle' },
  { token: '--ov-accent-fg', label: 'fg' },
];

const statusGroups = [
  {
    name: 'Success',
    tokens: [
      { token: '--ov-success-emphasis', label: 'emphasis' },
      { token: '--ov-success-default', label: 'default' },
      { token: '--ov-success-muted', label: 'muted' },
    ],
  },
  {
    name: 'Warning',
    tokens: [
      { token: '--ov-warning-emphasis', label: 'emphasis' },
      { token: '--ov-warning-default', label: 'default' },
      { token: '--ov-warning-muted', label: 'muted' },
    ],
  },
  {
    name: 'Danger',
    tokens: [
      { token: '--ov-danger-emphasis', label: 'emphasis' },
      { token: '--ov-danger-default', label: 'default' },
      { token: '--ov-danger-muted', label: 'muted' },
    ],
  },
  {
    name: 'Info',
    tokens: [
      { token: '--ov-info-emphasis', label: 'emphasis' },
      { token: '--ov-info-default', label: 'default' },
      { token: '--ov-info-muted', label: 'muted' },
    ],
  },
];

const typographyScale = [
  { token: '--ov-text-xs', label: 'xs', note: '11px' },
  { token: '--ov-text-sm', label: 'sm', note: '12px' },
  { token: '--ov-text-base', label: 'base', note: '14px' },
  { token: '--ov-text-md', label: 'md', note: '15px' },
  { token: '--ov-text-lg', label: 'lg', note: '16px' },
  { token: '--ov-text-xl', label: 'xl', note: '20px' },
  { token: '--ov-text-2xl', label: '2xl', note: '24px' },
];

const spacingScale = [
  { token: '--ov-space-0', label: '0', px: '0px' },
  { token: '--ov-space-1', label: '1', px: '4px' },
  { token: '--ov-space-2', label: '2', px: '8px' },
  { token: '--ov-space-3', label: '3', px: '12px' },
  { token: '--ov-space-4', label: '4', px: '16px' },
  { token: '--ov-space-5', label: '5', px: '20px' },
  { token: '--ov-space-6', label: '6', px: '24px' },
  { token: '--ov-space-8', label: '8', px: '32px' },
  { token: '--ov-space-10', label: '10', px: '40px' },
  { token: '--ov-space-12', label: '12', px: '48px' },
];

const shadowLevels = [
  { token: '--ov-shadow-sm', label: 'sm' },
  { token: '--ov-shadow-md', label: 'md' },
  { token: '--ov-shadow-lg', label: 'lg' },
  { token: '--ov-shadow-xl', label: 'xl' },
];

const radiusLevels = [
  { token: '--ov-radius-none', label: 'none' },
  { token: '--ov-radius-sm', label: 'sm' },
  { token: '--ov-radius-md', label: 'md' },
  { token: '--ov-radius-lg', label: 'lg' },
  { token: '--ov-radius-xl', label: 'xl' },
  { token: '--ov-radius-full', label: 'full' },
];

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const swatchLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--ov-font-mono)',
  fontSize: 'var(--ov-text-xs)',
  color: 'var(--ov-fg-muted)',
  marginTop: 4,
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const groupHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--ov-font-ui)',
  fontSize: 'var(--ov-text-sm)',
  fontWeight: 600,
  color: 'var(--ov-fg-muted)',
  marginBottom: 8,
};

// ---------------------------------------------------------------------------
// Swatch helper
// ---------------------------------------------------------------------------

function Swatch({
  token,
  label,
  width = 48,
  height = 32,
  checkerboard = false,
}: {
  token: string;
  label: string;
  width?: number;
  height?: number;
  checkerboard?: boolean;
}) {
  const bgImage = checkerboard
    ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width }}>
      <div
        style={{
          width,
          height,
          borderRadius: 4,
          backgroundColor: `var(${token})`,
          border: '1px solid var(--ov-border-muted)',
          ...(checkerboard
            ? {
                backgroundImage: bgImage,
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
              }
            : {}),
        }}
      />
      <span style={swatchLabelStyle}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swatch group helper
// ---------------------------------------------------------------------------

function SwatchGroup({
  title,
  tokens,
  checkerboard,
}: {
  title: string;
  tokens: { token: string; label: string }[];
  checkerboard?: boolean;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={groupHeadingStyle}>{title}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tokens.map((t) => (
          <Swatch key={t.token} token={t.token} label={t.label} checkerboard={checkerboard} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ThemePage() {
  return (
    <Box>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-semibold)',
          color: 'var(--ov-fg-base)',
          mb: '8px',
        }}
      >
        Theme & Tokens
      </Typography>
      <Typography
        variant="body1"
        sx={{ color: 'var(--ov-fg-muted)', mb: '32px', maxWidth: 640, lineHeight: 1.6 }}
      >
        The Omniview design system is powered by CSS custom properties organized into a three-tier
        token architecture: primitives, semantic tokens, and component tokens. This page showcases
        the full token surface.
      </Typography>

      {/* ----------------------------------------------------------------
       * Color Primitives
       * -------------------------------------------------------------- */}
      <Section
        title="Color Primitives"
        description="The 14-step neutral gray scale used as the foundation for all semantic color tokens. These raw values should never be referenced directly in components."
      >
        <Example title="Gray Scale">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {grayScale.map(({ token, index }) => (
              <Swatch key={token} token={token} label={String(index)} />
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Semantic Colors
       * -------------------------------------------------------------- */}
      <Section
        title="Semantic Colors"
        description="Purpose-named tokens that map to the primitive scale. These are the primary interface for styling components."
      >
        <Example title="Backgrounds">
          <SwatchGroup title="Backgrounds" tokens={bgTokens} />
        </Example>

        <Example title="Foreground / Text">
          <SwatchGroup title="Foreground" tokens={fgTokens} checkerboard />
        </Example>

        <Example title="Borders">
          <SwatchGroup title="Borders" tokens={borderTokens} />
        </Example>

        <Example title="Accent">
          <SwatchGroup title="Accent" tokens={accentTokens} checkerboard />
        </Example>

        <Example title="Status Colors">
          {statusGroups.map((group) => (
            <SwatchGroup
              key={group.name}
              title={group.name}
              tokens={group.tokens}
              checkerboard
            />
          ))}
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Typography Scale
       * -------------------------------------------------------------- */}
      <Section
        title="Typography Scale"
        description="Font size tokens based on a modular scale. All sizes use rem units for accessibility."
      >
        <Example title="Text Sizes">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {typographyScale.map(({ token, label, note }) => (
              <div key={token} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <span
                  style={{
                    fontFamily: 'var(--ov-font-mono)',
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-faint)',
                    minWidth: 120,
                    flexShrink: 0,
                  }}
                >
                  {token}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--ov-font-mono)',
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-disabled)',
                    minWidth: 40,
                    flexShrink: 0,
                  }}
                >
                  {note}
                </span>
                <span
                  style={{
                    fontSize: `var(${token})`,
                    color: 'var(--ov-fg-default)',
                    fontFamily: 'var(--ov-font-ui)',
                  }}
                >
                  The quick brown fox ({label})
                </span>
              </div>
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Spacing Scale
       * -------------------------------------------------------------- */}
      <Section
        title="Spacing Scale"
        description="A 4px-grid spacing scale used for padding, margin, and gap values throughout the system."
      >
        <Example title="Spacing Values">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {spacingScale.map(({ token, label, px }) => (
              <div key={token} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    fontFamily: 'var(--ov-font-mono)',
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-faint)',
                    minWidth: 120,
                    flexShrink: 0,
                  }}
                >
                  {token}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--ov-font-mono)',
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-disabled)',
                    minWidth: 36,
                    flexShrink: 0,
                  }}
                >
                  {px}
                </span>
                <div
                  style={{
                    width: `var(${token})`,
                    minWidth: label === '0' ? 2 : undefined,
                    height: 16,
                    backgroundColor: 'var(--ov-accent)',
                    borderRadius: 2,
                    transition: 'width var(--ov-duration-normal) var(--ov-ease-default)',
                  }}
                />
              </div>
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Elevation / Shadows
       * -------------------------------------------------------------- */}
      <Section
        title="Elevation / Shadows"
        description="Shadow tokens for conveying visual depth. Darker themes use heavier shadows to maintain perceived elevation."
      >
        <Example title="Shadow Levels">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {shadowLevels.map(({ token, label }) => (
              <div
                key={token}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
              >
                <div
                  style={{
                    width: 120,
                    height: 80,
                    backgroundColor: 'var(--ov-bg-surface-raised)',
                    borderRadius: 'var(--ov-radius-md)',
                    boxShadow: `var(${token})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--ov-font-mono)',
                      fontSize: 'var(--ov-text-sm)',
                      color: 'var(--ov-fg-muted)',
                    }}
                  >
                    {label}
                  </span>
                </div>
                <span style={swatchLabelStyle}>{token}</span>
              </div>
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Border Radius
       * -------------------------------------------------------------- */}
      <Section
        title="Border Radius"
        description="Radius tokens for controlling corner rounding across components."
      >
        <Example title="Radius Levels">
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {radiusLevels.map(({ token, label }) => (
              <div
                key={token}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    backgroundColor: 'var(--ov-accent)',
                    borderRadius: `var(${token})`,
                  }}
                />
                <span style={swatchLabelStyle}>{label}</span>
              </div>
            ))}
          </div>
        </Example>
      </Section>

      {/* ----------------------------------------------------------------
       * Theme Toggle
       * -------------------------------------------------------------- */}
      <Section
        title="Theme Toggle"
        description="Switch between built-in themes at runtime. The dark and light buttons call resetTheme() which removes all inline overrides. High-contrast sets the data-ov-theme attribute directly."
      >
        <Example title="Switch Theme">
          <ButtonGroup variant="outlined" size="medium">
            <Button onClick={() => resetTheme('dark')}>Dark</Button>
            <Button onClick={() => resetTheme('light')}>Light</Button>
            <Button
              onClick={() => {
                document.documentElement.setAttribute('data-ov-theme', 'high-contrast');
                document.documentElement.removeAttribute('style');
              }}
            >
              High Contrast
            </Button>
          </ButtonGroup>
        </Example>
      </Section>
    </Box>
  );
}
