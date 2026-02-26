import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import { LuChevronDown, LuChevronRight, LuRefreshCw } from 'react-icons/lu';

import { schemaRegistry, type EditorSchemaEntry } from '@/providers/monaco/schemaRegistry';
import { monaco } from '@/providers/monaco/bootstrap';

type SchemaSnapshot = Record<string, EditorSchemaEntry[]>;

interface ModelInfo {
  uri: string;
  language: string;
  version: number;
  contentLength: number;
}

const AUTO_REFRESH_MS = 5000;

const EditorDebugPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [flushedSchemas, setFlushedSchemas] = useState<Array<{ uri: string; fileMatch: string[]; schema?: object }>>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showFlushed, setShowFlushed] = useState(false);

  const refresh = useCallback(() => {
    setSnapshot(schemaRegistry.getSnapshot());
    setFlushedSchemas(schemaRegistry.getLastFlushedYamlSchemas());
    setModels(
      monaco.editor.getModels().map((m) => ({
        uri: m.uri.toString(),
        language: m.getLanguageId(),
        version: m.getVersionId(),
        contentLength: m.getValue().length,
      })),
    );
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const toggleKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const totalSchemas = schemaRegistry.getSchemaCount();
  const keys = Object.keys(snapshot);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.surface',
          minHeight: 32,
          flexShrink: 0,
        }}
      >
        <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
          Editor Debug
        </Text>
        <Divider orientation="vertical" sx={{ mx: 0.5 }} />
        <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled' }}>
          {totalSchemas} schemas | {keys.length} registrations | {models.length} models
        </Text>
        <Box sx={{ flex: 1 }} />
        <Tooltip content="Refresh">
          <IconButton size="sm" emphasis="ghost" color="neutral" onClick={refresh}>
            <LuRefreshCw size={14} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: 'black' }}>
        {/* Schema Registry Section */}
        <SectionHeader title="Schema Registry" count={totalSchemas} />
        {keys.length === 0 && (
          <Row>
            <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', pl: 2 }}>
              No schemas registered
            </Text>
          </Row>
        )}
        {keys.map((key) => {
          const entries = snapshot[key];
          const isExpanded = expandedKeys.has(key);
          return (
            <React.Fragment key={key}>
              <Row
                onClick={() => toggleKey(key)}
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'background.level1' } }}
              >
                {isExpanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                <Text size="xs" sx={{ fontFamily: 'monospace', color: 'primary.main', ml: 0.5 }}>
                  {key}
                </Text>
                <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', ml: 1 }}>
                  ({entries.length} schemas)
                </Text>
              </Row>
              {isExpanded && entries.map((entry, i) => (
                <Row key={i} sx={{ pl: 3 }}>
                  <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {entry.resourceKey}
                  </Text>
                  <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', ml: 1 }}>
                    match={entry.fileMatch} uri={entry.uri} lang={entry.language}
                    {entry.schema ? ` schema=${JSON.stringify(entry.schema).slice(0, 80)}...` : ''}
                  </Text>
                </Row>
              ))}
            </React.Fragment>
          );
        })}

        {/* Monaco Models Section */}
        <SectionHeader title="Monaco Models" count={models.length} />
        {models.length === 0 && (
          <Row>
            <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', pl: 2 }}>
              No models open
            </Text>
          </Row>
        )}
        {models.map((m, i) => (
          <Row key={i}>
            <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.secondary', pl: 2 }}>
              {m.uri}
            </Text>
            <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', ml: 1 }}>
              lang={m.language} ver={m.version} len={m.contentLength}
            </Text>
          </Row>
        ))}

        {/* Last Flushed YAML Config Section */}
        <Box>
          <Row
            onClick={() => setShowFlushed(!showFlushed)}
            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'background.level1' } }}
          >
            {showFlushed ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
            <Text size="xs" weight="semibold" sx={{ fontFamily: 'monospace', color: 'text.primary', ml: 0.5 }}>
              Last Flushed YAML Config
            </Text>
            <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled', ml: 1 }}>
              ({flushedSchemas.length} schemas)
            </Text>
          </Row>
          {showFlushed && (
            <Row sx={{ pl: 3 }}>
              <Text
                component="pre"
                size="xs"
                sx={{
                  fontFamily: 'monospace',
                  color: 'text.secondary',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  m: 0,
                }}
              >
                {JSON.stringify(flushedSchemas.map(({ uri, fileMatch }) => ({ uri, fileMatch })), null, 2)}
              </Text>
            </Row>
          )}
        </Box>
      </Box>
    </Box>
  );
};

// Reusable row wrapper
const Row: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  sx?: Record<string, unknown>;
}> = ({ children, onClick, sx }) => (
  <Box
    onClick={onClick}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.5,
      px: 1,
      py: '2px',
      fontFamily: 'monospace',
      fontSize: '12px',
      lineHeight: '18px',
      ...sx,
    }}
  >
    {children}
  </Box>
);

// Section header
const SectionHeader: React.FC<{ title: string; count: number }> = ({ title, count }) => (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      px: 1,
      py: 0.5,
      mt: 0.5,
      borderBottom: '1px solid',
      borderColor: 'divider',
    }}
  >
    <Text size="xs" weight="semibold" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
      {title}
    </Text>
    <Text size="xs" sx={{ fontFamily: 'monospace', color: 'text.disabled' }}>
      ({count})
    </Text>
  </Box>
);

export default React.memo(EditorDebugPanel);
