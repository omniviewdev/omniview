import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import Section from '../helpers/Section';
import Example from '../helpers/Example';
import ImportStatement from '../helpers/ImportStatement';
import PropsTable from '../helpers/PropsTable';

import {
  ProviderCard,
  ModelSelector,
  SettingsPanel,
  MCPServerConfig,
} from '@omniviewdev/ui/ai';
import type { ModelInfo, ProviderInfo, MCPServer, AISettingsValues } from '@omniviewdev/ui/ai';

const mockProviders: ProviderInfo[] = [
  { id: 'ollama', name: 'Ollama', type: 'ollama', endpoint: 'http://localhost:11434', status: 'connected' },
  { id: 'openai', name: 'OpenAI', type: 'openai', endpoint: 'https://api.openai.com/v1', status: 'connected' },
  { id: 'anthropic', name: 'Anthropic', type: 'anthropic', endpoint: 'https://api.anthropic.com', status: 'disconnected' },
];

const mockModels: ModelInfo[] = [
  { id: 'llama3.2', name: 'Llama 3.2', provider: 'Ollama', contextWindow: 128000, parameterCount: '8B' },
  { id: 'codellama', name: 'Code Llama', provider: 'Ollama', contextWindow: 16000, parameterCount: '13B' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', contextWindow: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI', contextWindow: 128000 },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', contextWindow: 200000 },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic', contextWindow: 200000 },
];

const mockServers: MCPServer[] = [
  { id: '1', name: 'Kubernetes Tools', url: 'http://localhost:3001/mcp', status: 'connected', capabilities: ['tools', 'resources'] },
  { id: '2', name: 'Prometheus Metrics', url: 'http://localhost:3002/mcp', status: 'disconnected', capabilities: ['resources'] },
  { id: '3', name: 'Git Operations', url: 'http://localhost:3003/mcp', status: 'error', capabilities: ['tools'] },
];

export default function AISettingsPage() {
  const [selectedModel, setSelectedModel] = useState('gpt-4o');
  const [settings, setSettings] = useState<AISettingsValues>({
    defaultModel: 'gpt-4o',
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    systemPrompt: 'You are a helpful DevOps assistant specialized in Kubernetes.',
  });
  const [servers, setServers] = useState(mockServers);

  return (
    <Box>
      <Typography
        variant="h4"
        sx={{ fontWeight: 'var(--ov-weight-bold)', color: 'var(--ov-fg-base)', mb: 3 }}
      >
        AI Settings
      </Typography>

      {/* ---- ProviderCard ---- */}
      <Section title="ProviderCard" description="Card for each AI provider showing connection status and actions.">
        <ImportStatement code="import { ProviderCard } from '@omniviewdev/ui/ai';" />

        <Example title="Provider Cards">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 500 }}>
            {mockProviders.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                onConfigure={() => alert(`Configure ${p.name}`)}
                onTestConnection={() => alert(`Test ${p.name}`)}
                onRemove={() => alert(`Remove ${p.name}`)}
              />
            ))}
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'provider', type: 'ProviderInfo', description: 'Provider data object' },
            { name: 'onConfigure', type: '(id: string) => void', description: 'Configure button handler' },
            { name: 'onTestConnection', type: '(id: string) => void', description: 'Test connection handler' },
            { name: 'onRemove', type: '(id: string) => void', description: 'Remove button handler' },
          ]}
        />
      </Section>

      {/* ---- ModelSelector ---- */}
      <Section title="ModelSelector" description="Dropdown for selecting AI models, grouped by provider.">
        <ImportStatement code="import { ModelSelector } from '@omniviewdev/ui/ai';" />

        <Example title="Grouped">
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <ModelSelector
              models={mockModels}
              value={selectedModel}
              onChange={setSelectedModel}
            />
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)' }}>
              Selected: {selectedModel}
            </Typography>
          </Box>
        </Example>

        <PropsTable
          props={[
            { name: 'models', type: 'ModelInfo[]', description: 'Available models' },
            { name: 'value', type: 'string', description: 'Selected model ID' },
            { name: 'onChange', type: '(modelId: string) => void', description: 'Selection handler' },
            { name: 'grouped', type: 'boolean', default: 'true', description: 'Group by provider' },
            { name: 'size', type: "'small' | 'medium'", default: "'small'", description: 'Component size' },
          ]}
        />
      </Section>

      {/* ---- SettingsPanel ---- */}
      <Section title="SettingsPanel" description="Full settings layout with model, parameters, and system prompt.">
        <ImportStatement code="import { SettingsPanel } from '@omniviewdev/ui/ai';" />

        <Example title="Interactive Settings">
          <SettingsPanel
            models={mockModels}
            values={settings}
            onChange={setSettings}
          />
        </Example>
      </Section>

      {/* ---- MCPServerConfig ---- */}
      <Section title="MCPServerConfig" description="MCP server management: list, add, remove, and view capabilities.">
        <ImportStatement code="import { MCPServerConfig } from '@omniviewdev/ui/ai';" />

        <Example title="Server List">
          <Box sx={{ maxWidth: 500 }}>
            <MCPServerConfig
              servers={servers}
              onAdd={() => alert('Add server')}
              onRemove={(id) => setServers((prev) => prev.filter((s) => s.id !== id))}
            />
          </Box>
        </Example>

        <Example title="Empty State">
          <Box sx={{ maxWidth: 500 }}>
            <MCPServerConfig
              servers={[]}
              onAdd={() => alert('Add server')}
              onRemove={() => {}}
            />
          </Box>
        </Example>
      </Section>
    </Box>
  );
}
