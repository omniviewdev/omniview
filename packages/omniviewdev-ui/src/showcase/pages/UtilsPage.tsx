import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import Section from '../helpers/Section';
import Example from '../helpers/Example';
import PropsTable from '../helpers/PropsTable';
import ImportStatement from '../helpers/ImportStatement';

import { formatTimeDifference } from '../../utils/time';
import { convertByteUnits } from '../../utils/units';
import { plural } from '../../utils/language';

// --- Shared styles ---

const resultBoxSx = {
  p: 2,
  borderRadius: '4px',
  bgcolor: 'var(--ov-bg-surface-inset)',
  fontFamily: 'var(--ov-font-mono)',
  fontSize: 'var(--ov-text-sm)',
  color: 'var(--ov-fg-default)',
};

const inputStyles: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 4,
  border: '1px solid var(--ov-border-default)',
  backgroundColor: 'var(--ov-bg-surface)',
  color: 'var(--ov-fg-default)',
  fontFamily: 'var(--ov-font-ui)',
  fontSize: 'var(--ov-text-sm)',
};

const selectStyles: React.CSSProperties = {
  ...inputStyles,
  cursor: 'pointer',
};

const presetTableStyles: React.CSSProperties = {
  borderCollapse: 'collapse',
  fontFamily: 'var(--ov-font-ui)',
  fontSize: 'var(--ov-text-sm)',
};

const presetThStyles: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px',
  fontWeight: 600,
  color: 'var(--ov-fg-muted)',
  borderBottom: '2px solid var(--ov-border-default)',
  whiteSpace: 'nowrap',
};

const presetTdStyles: React.CSSProperties = {
  padding: '6px 12px',
  color: 'var(--ov-fg-default)',
  borderBottom: '1px solid var(--ov-border-muted)',
};

const presetTdMono: React.CSSProperties = {
  ...presetTdStyles,
  fontFamily: 'var(--ov-font-mono)',
};

// --- Page ---

export default function UtilsPage() {
  // formatTimeDifference state
  const [dateInput, setDateInput] = useState('');
  const timeResult = useMemo(() => {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'Invalid date';
    return formatTimeDifference(d);
  }, [dateInput]);

  // Preset time examples
  const fiveMinAgo = useMemo(() => formatTimeDifference(new Date(Date.now() - 5 * 60 * 1000)), []);
  const twoHoursAgo = useMemo(() => formatTimeDifference(new Date(Date.now() - 2 * 60 * 60 * 1000)), []);
  const threeDaysAgo = useMemo(() => formatTimeDifference(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)), []);

  // convertByteUnits state
  const [byteFrom, setByteFrom] = useState('1024Ki');
  const [byteTo, setByteTo] = useState('MB');
  const byteResult = useMemo(() => {
    if (!byteFrom) return '';
    return convertByteUnits({ from: byteFrom, to: byteTo as any });
  }, [byteFrom, byteTo]);

  // plural state
  const [pluralWord, setPluralWord] = useState('child');
  const [pluralAmount, setPluralAmount] = useState(2);
  const pluralResult = useMemo(() => {
    return plural(pluralWord, pluralAmount);
  }, [pluralWord, pluralAmount]);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{
          fontWeight: 'var(--ov-weight-bold)',
          color: 'var(--ov-fg-base)',
          mb: '32px',
        }}
      >
        Utilities
      </Typography>

      {/* ---- formatTimeDifference ---- */}
      <Section
        title="formatTimeDifference"
        description="Formats the difference between a given date and now into a compact human-readable string (e.g. 5m23s, 2h15m, 3d). Useful for displaying resource ages."
      >
        <ImportStatement code="import { formatTimeDifference } from '@omniviewdev/ui/utils';" />

        <Example title="Interactive demo" description="Select a date/time and see the formatted time difference.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <input
              type="datetime-local"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              style={inputStyles}
            />
            <Box sx={resultBoxSx}>
              Result: <strong>{timeResult || '(select a date above)'}</strong>
            </Box>
          </Box>
        </Example>

        <Example title="Preset examples" description="Common time differences and their formatted output.">
          <table style={presetTableStyles}>
            <thead>
              <tr>
                <th style={presetThStyles}>Input</th>
                <th style={presetThStyles}>Output</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={presetTdStyles}>5 minutes ago</td>
                <td style={presetTdMono}>{fiveMinAgo}</td>
              </tr>
              <tr>
                <td style={presetTdStyles}>2 hours ago</td>
                <td style={presetTdMono}>{twoHoursAgo}</td>
              </tr>
              <tr>
                <td style={presetTdStyles}>3 days ago</td>
                <td style={presetTdMono}>{threeDaysAgo}</td>
              </tr>
            </tbody>
          </table>
        </Example>

        <PropsTable
          props={[
            { name: 'date', type: 'Date', description: 'The date to calculate the difference from. Compared against Date.now().' },
          ]}
        />
      </Section>

      {/* ---- convertByteUnits ---- */}
      <Section
        title="convertByteUnits"
        description="Converts Kubernetes-style byte strings (e.g. 1024Ki, 512Mi, 2Gi) between units. Supports both SI (KB, MB, GB) and binary (Ki, Mi, Gi) units."
      >
        <ImportStatement code="import { convertByteUnits } from '@omniviewdev/ui/utils';" />

        <Example title="Interactive demo" description='Enter a byte value with unit suffix (e.g. "1024Ki") and select a target unit.'>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>From</Typography>
                <input
                  type="text"
                  value={byteFrom}
                  onChange={(e) => setByteFrom(e.target.value)}
                  placeholder="e.g. 1024Ki"
                  style={{ ...inputStyles, width: 160 }}
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>To</Typography>
                <select
                  value={byteTo}
                  onChange={(e) => setByteTo(e.target.value)}
                  style={selectStyles}
                >
                  <option value="B">B</option>
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                  <option value="TB">TB</option>
                  <option value="Ki">Ki</option>
                  <option value="Mi">Mi</option>
                  <option value="Gi">Gi</option>
                  <option value="Ti">Ti</option>
                </select>
              </Box>
            </Box>
            <Box sx={resultBoxSx}>
              Result: <strong>{byteResult || '(enter a value above)'}</strong>
            </Box>
          </Box>
        </Example>

        <Example title="Preset examples" description="Common byte conversions.">
          <table style={presetTableStyles}>
            <thead>
              <tr>
                <th style={presetThStyles}>From</th>
                <th style={presetThStyles}>To</th>
                <th style={presetThStyles}>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={presetTdMono}>1024Ki</td>
                <td style={presetTdMono}>MB</td>
                <td style={presetTdMono}>{convertByteUnits({ from: '1024Ki', to: 'MB' })}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>512Mi</td>
                <td style={presetTdMono}>GB</td>
                <td style={presetTdMono}>{convertByteUnits({ from: '512Mi', to: 'GB' })}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>2Gi</td>
                <td style={presetTdMono}>MB</td>
                <td style={presetTdMono}>{convertByteUnits({ from: '2Gi', to: 'MB' })}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>1TB</td>
                <td style={presetTdMono}>GB</td>
                <td style={presetTdMono}>{convertByteUnits({ from: '1TB', to: 'GB' })}</td>
              </tr>
            </tbody>
          </table>
        </Example>

        <PropsTable
          props={[
            { name: 'from', type: 'string', description: 'The byte value with unit suffix to convert from (e.g. "1024Ki", "512Mi").' },
            { name: 'to', type: 'ByteUnit', default: '"MB"', description: 'Target unit: B, KB, MB, GB, TB, Ki, Mi, Gi, Ti, etc.' },
            { name: 'round', type: 'boolean | number', description: 'If true, rounds the result. If a number, rounds to that many decimal places.' },
          ]}
        />
      </Section>

      {/* ---- plural ---- */}
      <Section
        title="plural"
        description="Returns the English plural form of a word. Handles regular rules, irregular words (child/children, mouse/mice), and uncountable nouns (fish, sheep). When amount is 1, returns the singular form."
      >
        <ImportStatement code="import { plural } from '@omniviewdev/ui/utils';" />

        <Example title="Interactive demo" description="Enter a word and an amount to see the pluralized result.">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>Word</Typography>
                <input
                  type="text"
                  value={pluralWord}
                  onChange={(e) => setPluralWord(e.target.value)}
                  placeholder="e.g. child"
                  style={{ ...inputStyles, width: 160 }}
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }}>Amount</Typography>
                <input
                  type="number"
                  value={pluralAmount}
                  onChange={(e) => setPluralAmount(Number(e.target.value))}
                  min={0}
                  style={{ ...inputStyles, width: 80 }}
                />
              </Box>
            </Box>
            <Box sx={resultBoxSx}>
              Result: <strong>{pluralAmount} {pluralResult}</strong>
            </Box>
          </Box>
        </Example>

        <Example title="Preset examples" description="Various word forms and their pluralized output.">
          <table style={presetTableStyles}>
            <thead>
              <tr>
                <th style={presetThStyles}>Word</th>
                <th style={presetThStyles}>Amount</th>
                <th style={presetThStyles}>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={presetTdMono}>child</td>
                <td style={presetTdStyles}>1</td>
                <td style={presetTdMono}>{plural('child', 1)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>child</td>
                <td style={presetTdStyles}>2</td>
                <td style={presetTdMono}>{plural('child', 2)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>fish</td>
                <td style={presetTdStyles}>1</td>
                <td style={presetTdMono}>{plural('fish', 1)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>fish</td>
                <td style={presetTdStyles}>3</td>
                <td style={presetTdMono}>{plural('fish', 3)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>mouse</td>
                <td style={presetTdStyles}>1</td>
                <td style={presetTdMono}>{plural('mouse', 1)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>mouse</td>
                <td style={presetTdStyles}>3</td>
                <td style={presetTdMono}>{plural('mouse', 3)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>pod</td>
                <td style={presetTdStyles}>5</td>
                <td style={presetTdMono}>{plural('pod', 5)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>namespace</td>
                <td style={presetTdStyles}>1</td>
                <td style={presetTdMono}>{plural('namespace', 1)}</td>
              </tr>
              <tr>
                <td style={presetTdMono}>namespace</td>
                <td style={presetTdStyles}>4</td>
                <td style={presetTdMono}>{plural('namespace', 4)}</td>
              </tr>
            </tbody>
          </table>
        </Example>

        <PropsTable
          props={[
            { name: 'word', type: 'string', description: 'The English word to pluralize.' },
            { name: 'amount', type: 'number', description: 'When 1, returns the singular form. Otherwise returns the plural. If omitted, always returns the plural.' },
          ]}
        />
      </Section>
    </Box>
  );
}
