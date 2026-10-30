import React, { useCallback, useEffect, useState } from 'react';
import { IconButton, Separator, Text } from '@omniviewdev/base-ui';
import { LuChevronDown, LuChevronRight, LuRefreshCw } from 'react-icons/lu';

import { schemaRegistry, type EditorSchemaEntry } from '@/providers/monaco/schemaRegistry';
import { monaco } from '@/providers/monaco/bootstrap';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './EditorDebugPanel.module.css';

type SchemaSnapshot = Record<string, EditorSchemaEntry[]>;

type ModelInfo = {
  uri: string;
  language: string;
  version: number;
  contentLength: number;
};

const AUTO_REFRESH_MS = 5000;

const EditorDebugPanel: React.FC = () => {
  const [snapshot, setSnapshot] = useState<SchemaSnapshot>(() => schemaRegistry.getSnapshot());
  const [models, setModels] = useState<ModelInfo[]>(() => monaco.editor.getModels().map((m) => ({
    uri: m.uri.toString(),
    language: m.getLanguageId(),
    version: m.getVersionId(),
    contentLength: m.getValue().length,
  })));
  const [flushedSchemas, setFlushedSchemas] = useState<Array<{ uri: string; fileMatch: string[]; schema?: Record<string, unknown> }>>(
    () => schemaRegistry.getLastFlushedYamlSchemas(),
  );
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
    const id = setInterval(refresh, AUTO_REFRESH_MS);
    return () => {
      clearInterval(id); 
    };
  }, [refresh]);

  const toggleKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  const totalSchemas = schemaRegistry.getSchemaCount();
  const keys = Object.keys(snapshot);

  return (
    <div className={styles.Root}>
      {/* Toolbar */}
      <div className={styles.Toolbar}>
        <Text size='xs' mono tone='muted'>Editor Debug</Text>
        <Separator orientation='vertical' className={styles.ToolbarSeparator} />
        <Text size='xs' mono tone='subtle'>
          {totalSchemas} schemas | {keys.length} registrations | {models.length} models
        </Text>
        <span className={styles.Spacer} />
        <HintTooltip content='Refresh'>
          <IconButton size='sm' variant='ghost' color='neutral' aria-label='Refresh' onClick={refresh}>
            <LuRefreshCw size={14} />
          </IconButton>
        </HintTooltip>
      </div>

      {/* Content */}
      <div className={styles.Content}>
        {/* Schema Registry Section */}
        <SectionHeader title='Schema Registry' count={totalSchemas} />
        {keys.length === 0 && (
          <Row indent={2}>
            <Text size='xs' mono tone='subtle'>No schemas registered</Text>
          </Row>
        )}
        {keys.map((key) => {
          const entries = snapshot[key];
          const isExpanded = expandedKeys.has(key);
          return (
            <React.Fragment key={key}>
              <Row onClick={() => {
                toggleKey(key); 
              }}>
                {isExpanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                <Text size='xs' mono tone='brand'>{key}</Text>
                <Text size='xs' mono tone='subtle'>({entries.length} schemas)</Text>
              </Row>
              {isExpanded && entries.map((entry, i) => (
                <Row key={i} indent={3}>
                  <Text size='xs' mono tone='muted'>{entry.type}</Text>
                  <Text size='xs' mono tone='subtle'>
                    match={entry.fileMatch} uri={entry.uri} lang={entry.language}
                    {entry.schema ? ` schema=${JSON.stringify(entry.schema).slice(0, 80)}...` : ''}
                  </Text>
                </Row>
              ))}
            </React.Fragment>
          );
        })}

        {/* Monaco Models Section */}
        <SectionHeader title='Monaco Models' count={models.length} />
        {models.length === 0 && (
          <Row indent={2}>
            <Text size='xs' mono tone='subtle'>No models open</Text>
          </Row>
        )}
        {models.map((m, i) => (
          <Row key={i} indent={2}>
            <Text size='xs' mono tone='muted'>{m.uri}</Text>
            <Text size='xs' mono tone='subtle'>
              lang={m.language} ver={m.version} len={m.contentLength}
            </Text>
          </Row>
        ))}

        {/* Last Flushed YAML Config Section */}
        <div>
          <Row onClick={() => {
            setShowFlushed(!showFlushed); 
          }}>
            {showFlushed ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
            <Text size='xs' mono weight='semibold'>Last Flushed YAML Config</Text>
            <Text size='xs' mono tone='subtle'>({flushedSchemas.length} schemas)</Text>
          </Row>
          {showFlushed && (
            <Row indent={3}>
              <pre className={styles.Pre}>
                {JSON.stringify(flushedSchemas.map(({ uri, fileMatch }) => ({ uri, fileMatch })), null, 2)}
              </pre>
            </Row>
          )}
        </div>
      </div>
    </div>
  );
};

// Reusable row wrapper. `indent` is in 8px steps.
const Row: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  indent?: number;
}> = ({ children, onClick, indent }) => (
  <div
    onClick={onClick}
    className={styles.Row}
    data-clickable={onClick ? true : undefined}
    style={indent ? { paddingLeft: indent * 8 } : undefined}
  >
    {children}
  </div>
);

// Section header
const SectionHeader: React.FC<{ title: string; count: number }> = ({ title, count }) => (
  <div className={styles.SectionHeader}>
    <Text size='xs' mono weight='semibold'>{title}</Text>
    <Text size='xs' mono tone='subtle'>({count})</Text>
  </div>
);

export default React.memo(EditorDebugPanel);
