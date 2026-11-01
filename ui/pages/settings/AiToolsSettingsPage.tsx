import React from 'react';
import { LuChevronDown } from 'react-icons/lu';

import { Button, Card, Chip, Select, Switch, Text, TextField } from '@omniviewdev/base-ui';
import { useConfirmationModal, useSnackbar } from '@omniviewdev/runtime';

import Icon from '@/components/icons/Icon';
import {
  GLOBAL_SCOPE,
  useMcpRelay,
  type McpConnectionPolicyView,
  type McpScope,
  type McpToolView,
} from '@/hooks/mcp/useMcpRelay';
import styles from './AiToolsSettingsPage.module.css';
import { SettingsFormRegistration } from '@/hooks/settings/useSettingsForm';
import formStyles from './SettingsPage.module.css';

const GLOBAL_SCOPE_KEY = 'global';
const INHERIT_PRESET = '__inherit__';

type SelectOption = { value: string; label: string };

type PolicySelectProps = {
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

const PolicySelect: React.FC<PolicySelectProps> = ({ ariaLabel, value, options, onChange, disabled }) => (
  <Select.Root
    size='sm'
    value={value}
    items={options}
    disabled={disabled}
    onValueChange={(next) => {
      if (next !== null) {
        onChange(next);
      }
    }}
  >
    <Select.Trigger aria-label={ariaLabel} className={styles.Field}>
      <Select.Value />
      <Select.Icon>
        <LuChevronDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner sideOffset={4}>
        <Select.Popup>
          <Select.List>
            {options.map(option => (
              <Select.Item key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

const scopeKey = (scope: McpScope) =>
  scope.pluginID === '' ? GLOBAL_SCOPE_KEY : `${scope.pluginID}\u0000${scope.connectionID}`;

const scopeFromKey = (key: string): McpScope => {
  if (key === GLOBAL_SCOPE_KEY) {
    return GLOBAL_SCOPE;
  }

  const [pluginID, connectionID] = key.split('\u0000');
  return { pluginID, connectionID };
};

const claudeCommand = (endpoint: string, token: string) =>
  `claude mcp add --transport http omniview ${endpoint} --header "Authorization: Bearer ${token}"`;

const jsonSnippet = (endpoint: string, token: string) =>
  JSON.stringify(
    { mcpServers: { omniview: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );


const AiToolsSettingsPage: React.FC = () => {
  const [scope, setScope] = React.useState<McpScope>(GLOBAL_SCOPE);
  const relay = useMcpRelay(scope);
  const { show: confirm } = useConfirmationModal();
  const { showSnackbar } = useSnackbar();
  const [tokenVisible, setTokenVisible] = React.useState(false);
  const [portDraft, setPortDraft] = React.useState<string | null>(null);
  const [presetName, setPresetName] = React.useState('');
  const registerForm = React.useContext(SettingsFormRegistration);
  const [draftError, setDraftError] = React.useState('');
  const [savingDraft, setSavingDraft] = React.useState(false);
  const hasDrafts = portDraft !== null || presetName.trim() !== '';
  const discardDrafts = () => {
    setPortDraft(null);
    setPresetName('');
    setDraftError('');
  };

  const saveDrafts = async () => {
    setSavingDraft(true);
    let portSaved = false;
    try {
      if (portDraft !== null) {
        await relay.setPort.mutateAsync(Number(portDraft));
        setPortDraft(null);
        portSaved = true;
      }

      if (presetName.trim()) {
        await relay.saveUserPreset.mutateAsync(presetName.trim());
        setPresetName('');
      }

      setDraftError('');
      return true;
    } catch {
      setDraftError(portSaved
        ? 'Port saved. Preset could not be saved. Retry saving the preset or discard its unsaved name.'
        : 'Could not save AI Tools changes. Unsaved changes remain. Retry or discard them.');
      return false;
    } finally {
      setSavingDraft(false);
    }
  };

  React.useLayoutEffect(() => {
    registerForm?.({
      saving: savingDraft,
      hasDrafts,
      discard: discardDrafts,
      save: saveDrafts,
    });
  });
  React.useLayoutEffect(() => () => registerForm?.(null), [registerForm]);

  const status = relay.status.data;
  const config = relay.config.isError ? undefined : relay.config.data;
  const presets = relay.presets.data ?? [];
  const connections = relay.connections.data ?? [];
  const tools = relay.tools.data;
  const isGlobal = scope.pluginID === '';
  const selectedConnection = connections.find(
    (c) => c.pluginID === scope.pluginID && c.connectionID === scope.connectionID,
  );

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        showSnackbar(`${label} copied`, 'success'); 
      },
      () => {
        showSnackbar(`Failed to copy ${label.toLowerCase()}`, 'error'); 
      },
    );
  };

  const applyPreset = (name: string) => {
    confirm({
      title: 'Apply preset',
      body: 'Applying a preset clears per-tool enable overrides for this scope. Confirm overrides stay.',
      confirmLabel: 'Apply',
      onConfirm: async () => relay.applyPreset.mutateAsync({ scope, name }),
    });
  };

  const presetOptions: SelectOption[] = presets.map((p) => ({
    value: p.name,
    label: p.builtIn ? `${p.name} (${p.toolCount} tools)` : `${p.name} (${p.toolCount} tools, saved)`,
  }));

  const scopeOptions: SelectOption[] = [
    { value: GLOBAL_SCOPE_KEY, label: 'Global default' },
    ...connections.map((c) => ({
      value: scopeKey({ pluginID: c.pluginID, connectionID: c.connectionID }),
      label: `${c.pluginName} · ${c.connectionName}`,
    })),
  ];

  const grouped = React.useMemo(() => {
    const groups = new Map<string, { pluginName: string; tools: McpToolView[] }>();
    for (const tool of tools ?? []) {
      const group = groups.get(tool.pluginID) ?? { pluginName: tool.pluginName, tools: [] };
      group.tools.push(tool);
      groups.set(tool.pluginID, group);
    }

    return [...groups.entries()];
  }, [tools]);

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <Icon name='LuBot' size={20} />
        <div className={styles.HeaderText}>
          <Text weight='semibold' size='lg'>AI Tools</Text>
          <Text size='xs'>Expose plugin tools to AI assistants over MCP and control what they may do</Text>
        </div>
      </div>

      <div className={styles.Body}>
        {draftError && <p role='alert'>{draftError}</p>}
        {([
          ['Configuration', relay.config],
          ['Server status', relay.status],
          ['Connection inventory', relay.connections],
          ['Tools', relay.tools],
          ['Presets', relay.presets],
        ] as const).map(([label, query]) => query.isError && (
          <div role='alert' key={label}>
            {label} could not be loaded.
            <Button size='sm' onClick={async () => {
              await query.refetch();
            }}>Retry {label.toLowerCase()}</Button>
          </div>
        ))}
        <fieldset disabled={!config || relay.config.isFetching || savingDraft} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Card className={styles.Card}>
            <div className={styles.CardTitle}>
              <Text size='md' weight='semibold'>Server</Text>
              <Switch
                checked={config?.enabled ?? false}
                disabled={!config}
                onCheckedChange={(checked) => {
                  relay.setEnabled.mutate(checked); 
                }}
              >
                Enabled
              </Switch>
            </div>
            <div className={styles.Status} role='status'>
              {relay.status.isError ? (
                <Chip variant='soft' color='danger' size='sm'>Status unavailable</Chip>
              ) : relay.status.isLoading ? (
                <Text size='sm'>Loading server status…</Text>
              ) : status?.error ? (
                <Chip variant='soft' color='danger' size='sm'>Error: {status.error}</Chip>
              ) : status?.running ? (
                <Chip variant='soft' color='success' size='sm'>Running at {status.endpoint}</Chip>
              ) : (
                <Chip variant='soft' color='neutral' size='sm'>Stopped</Chip>
              )}
            </div>
            <div className={styles.Row}>
              <TextField.Root size='sm' className={styles.PortField}>
                <TextField.Label>Port</TextField.Label>
                <TextField.Control
                  type='number'
                  value={portDraft ?? String(config?.port ?? '')}
                  onChange={(e) => {
                    setPortDraft(e.target.value); 
                  }}
                />
              </TextField.Root>
              <Button
                size='sm'
                variant='outline'
                disabled={portDraft === null || portDraft === String(config?.port ?? '')}
                onClick={() => {
                  const port = Number(portDraft);
                  relay.setPort.mutate(port, { onSuccess: () => {
                    setPortDraft(null); 
                  } });
                }}
              >
                Apply port
              </Button>
            </div>
            <div className={styles.Row}>
              <Text size='sm'>Token:</Text>
              <Text size='sm' className={styles.ToolName}>
                {tokenVisible ? config?.token ?? '' : '••••••••••••'}
              </Text>
              <Button size='sm' variant='ghost' onClick={() => {
                setTokenVisible((v) => !v); 
              }}>
                {tokenVisible ? 'Hide' : 'Reveal'}
              </Button>
              <Button size='sm' variant='ghost' disabled={!config} onClick={() => {
                copy('Token', config?.token ?? ''); 
              }}>
                Copy token
              </Button>
              <Button
                size='sm'
                variant='outline'
                color='danger'
                onClick={() => {
                  confirm({
                    title: 'Rotate token',
                    body: 'Every client must be reconfigured with the new token.',
                    confirmLabel: 'Rotate',
                    onConfirm: async () => relay.rotateToken.mutateAsync(),
                  }); 
                }
                }
              >
                Rotate token
              </Button>
            </div>
            {config && (
              <div className={styles.Snippet}>
                <Text size='sm' weight='semibold'>Client setup</Text>
                <div className={styles.Row}>
                  <Text size='xs' className={styles.Muted}>Claude Code</Text>
                  <Button size='sm' variant='ghost' onClick={() => {
                    copy('Claude command', claudeCommand(config.endpoint, config.token)); 
                  }}>
                    Copy command
                  </Button>
                </div>
                <pre className={styles.SnippetCode}>{claudeCommand(config.endpoint, tokenVisible ? config.token : '<token>')}</pre>
                <div className={styles.Row}>
                  <Text size='xs' className={styles.Muted}>JSON (mcpServers)</Text>
                  <Button size='sm' variant='ghost' onClick={() => {
                    copy('JSON config', jsonSnippet(config.endpoint, config.token)); 
                  }}>
                    Copy JSON
                  </Button>
                </div>
                <pre className={styles.SnippetCode}>{jsonSnippet(config.endpoint, tokenVisible ? config.token : '<token>')}</pre>
              </div>
            )}
          </Card>

          <Card className={styles.Card}>
            <div className={styles.CardTitle}>
              <Text size='md' weight='semibold'>Policy scope</Text>
              <Switch
                checked={config?.blockConnectionsByDefault ?? false}
                disabled={!config}
                onCheckedChange={(checked) => {
                  relay.setBlockConnectionsByDefault.mutate(checked); 
                }}
              >
                Block connections by default
              </Switch>
            </div>
            <div className={styles.Row}>
              <PolicySelect
                ariaLabel='Policy scope'
                value={scopeKey(scope)}
                options={scopeOptions}
                onChange={(key) => {
                  setScope(scopeFromKey(key)); 
                }}
              />
              {selectedConnection && (
                <ConnectionControls
                  connection={selectedConnection}
                  presetOptions={presetOptions}
                  onAccessChange={(access) => {
                    relay.setConnectionAccess.mutate({
                      pluginID: selectedConnection.pluginID,
                      connectionID: selectedConnection.connectionID,
                      access,
                    }); 
                  }
                  }
                  onPresetChange={(name) => {
                    applyPreset(name === INHERIT_PRESET ? '' : name); 
                  }}
                  blockByDefault={config?.blockConnectionsByDefault ?? false}
                />
              )}
            </div>
          </Card>

          {isGlobal && (
            <Card className={styles.Card}>
              <Text size='md' weight='semibold'>Presets</Text>
              <div className={styles.Row}>
                <PolicySelect
                  ariaLabel='Global preset'
                  value={config?.globalPreset ?? 'read-only'}
                  options={presetOptions}
                  onChange={applyPreset}
                />
                <TextField.Root size='sm' className={styles.Field}>
                  <TextField.Label>Save current selection as preset</TextField.Label>
                  <TextField.Control
                    value={presetName}
                    placeholder='Preset name'
                    onChange={(e) => {
                      setPresetName(e.target.value); 
                    }}
                  />
                </TextField.Root>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={presetName.trim() === ''}
                  onClick={() => {
                    relay.saveUserPreset.mutate(presetName.trim(), { onSuccess: () => {
                      setPresetName(''); 
                    } }); 
                  }
                  }
                >
                  Save preset
                </Button>
              </div>
              {presets.filter((p) => !p.builtIn).length > 0 && (
                <div className={styles.Row}>
                  {presets.filter((p) => !p.builtIn).map((p) => (
                    <Chip key={p.name} variant='outline' color='neutral' size='sm'>
                      {p.name}
                      <button
                        type='button'
                        className={styles.ResetLink}
                        aria-label={`Delete preset ${p.name}`}
                        onClick={() => {
                          relay.deleteUserPreset.mutate(p.name); 
                        }}
                      >
                        delete
                      </button>
                    </Chip>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Card className={styles.Card}>
            <Text size='md' weight='semibold'>
              {isGlobal ? 'Tools' : `Tools on ${selectedConnection?.connectionName ?? scope.connectionID}`}
            </Text>
            <Text size='xs'>Tool annotations are provider hints, not permissions. Host policy and native authorization still apply.</Text>
            {relay.tools.isLoading && <Text size='sm' role='status'>Loading tools…</Text>}
            {!relay.tools.isLoading && !relay.tools.isError && grouped.length === 0 && (
              <Text size='sm' className={styles.Muted}>No plugin exposes tools yet.</Text>
            )}
            {grouped.map(([pluginID, group]) => (
              <PluginToolGroup
                key={pluginID}
                pluginID={pluginID}
                pluginName={group.pluginName}
                tools={group.tools}
                scope={scope}
                onPluginEnabled={(enabled) => {
                  relay.setPluginEnabled.mutate({ pluginID, enabled }); 
                }}
                onOverride={(rowScope, mcpName, override) => {
                  relay.setToolOverride.mutate({ scope: rowScope, mcpName, override });
                }}
              />
            ))}
          </Card>
        </fieldset>
      </div>
      <div className={formStyles.ActionBar}>
        <span role='status'>{hasDrafts ? 'Unsaved changes' : 'All changes saved'}</span>
        <div className={formStyles.Actions}>
          {hasDrafts && <>
            <Button color='neutral' variant='ghost' onClick={discardDrafts} disabled={savingDraft}>Discard</Button>
            <Button color='brand' variant='soft' onClick={saveDrafts} disabled={savingDraft || !config || relay.config.isFetching} aria-label='Save Changes' aria-busy={savingDraft}>
              {savingDraft ? 'Checking and saving…' : 'Save Changes'}
            </Button>
          </>}
        </div>
      </div>
    </div>
  );
};

type ConnectionControlsProps = {
  connection: McpConnectionPolicyView;
  presetOptions: SelectOption[];
  blockByDefault: boolean;
  onAccessChange: (access: string) => void;
  onPresetChange: (name: string) => void;
};

const ConnectionControls: React.FC<ConnectionControlsProps> = ({
  connection,
  presetOptions,
  blockByDefault,
  onAccessChange,
  onPresetChange,
}) => (
  <>
    <PolicySelect
      ariaLabel='Connection access'
      value={connection.access}
      options={[
        { value: '', label: `Inherit default (${blockByDefault ? 'blocked' : 'allowed'})` },
        { value: 'allowed', label: 'Allowed' },
        { value: 'blocked', label: 'Blocked' },
      ]}
      onChange={onAccessChange}
    />
    <PolicySelect
      ariaLabel='Connection preset'
      value={connection.preset === '' ? INHERIT_PRESET : connection.preset}
      options={[{ value: INHERIT_PRESET, label: 'Inherit global' }, ...presetOptions]}
      onChange={onPresetChange}
    />
  </>
);

type PluginToolGroupProps = {
  pluginID: string;
  pluginName: string;
  tools: McpToolView[];
  scope: McpScope;
  onPluginEnabled: (enabled: boolean) => void;
  onOverride: (scope: McpScope, mcpName: string, override: { enabled: boolean | null; confirm: boolean | null }) => void;
};

const PluginToolGroup: React.FC<PluginToolGroupProps> = ({
  pluginID,
  pluginName,
  tools,
  scope,
  onPluginEnabled,
  onOverride,
}) => {
  const pluginDisabled = tools.some((t) => t.enabledSource === 'plugin-disabled');
  return (
    <div className={styles.PluginGroup} role='group' aria-label={pluginName}>
      <div className={styles.PluginHeader}>
        <Text size='sm' weight='semibold'>{pluginName}</Text>
        {scope.pluginID === '' && (
          <div className={styles.Status}>
            <Text size='xs' className={styles.Muted}>Plugin tools</Text>
            <Switch
              size='sm'
              checked={!pluginDisabled}
              onCheckedChange={onPluginEnabled}
              aria-label={`Enable ${pluginName} tools`}
            />
          </div>
        )}
      </div>
      {tools.map((tool) => (
        <ToolRow
          key={`${tool.pluginID}\u0000${tool.connectionID}\u0000${tool.mcpName}`}
          tool={tool}
          pluginID={pluginID}
          onOverride={(mcpName, override) => {
            onOverride(
              tool.scope === 'connection' && tool.connectionID
                ? { pluginID: tool.pluginID, connectionID: tool.connectionID }
                : scope,
              mcpName,
              override,
            );
          }}
        />
      ))}
    </div>
  );
};

type ToolRowProps = {
  tool: McpToolView;
  pluginID: string;
  onOverride: (mcpName: string, override: { enabled: boolean | null; confirm: boolean | null }) => void;
};

const ToolRow: React.FC<ToolRowProps> = ({ tool, onOverride }) => {
  const controlsDisabled = tool.status !== 'ok';
  const statusLabel: Record<string, string> = {
    conflict: 'name conflict',
    'invalid-name': 'invalid name',
    'invalid-schema': 'invalid schema',
  };
  return (
    <div className={styles.ToolRow}>
      <div className={styles.ToolInfo}>
        <Text size='sm' className={styles.ToolName}>{tool.mcpName}</Text>
        {tool.description && <Text size='xs' className={styles.Muted}>{tool.description}</Text>}
        <Text size='xs'>Policy: {tool.enabled ? 'enabled' : 'disabled'} ({tool.enabledSource}); consent {tool.confirm ? 'required' : 'not required'} ({tool.confirmSource})</Text>
        <Text size='xs'>Route: {tool.connectionID || (tool.scope === 'connection' ? 'connection (not bound)' : 'plugin')} · {tool.ready ? 'ready' : 'not ready'} · {tool.listed ? 'advertised' : 'not advertised'}</Text>
        <div className={styles.Chips}>
          {tool.status !== 'ok' && (
            <Chip variant='soft' color='danger' size='xs'>{statusLabel[tool.status] ?? tool.status}</Chip>
          )}
          {tool.readOnly && <Chip variant='soft' color='success' size='xs'>read-only hint</Chip>}
          {tool.destructive && <Chip variant='soft' color='danger' size='xs'>destructive hint</Chip>}
          {tool.scope === 'connection' && <Chip variant='outline' color='neutral' size='xs'>connection</Chip>}
          {tool.builtIn && <Chip variant='outline' color='neutral' size='xs'>built-in</Chip>}
        </div>
      </div>
      <div className={styles.ToolControl}>
        <div className={styles.Status}>
          <Text size='xs' className={styles.Muted}>Enabled</Text>
          <Switch
            size='sm'
            checked={tool.enabled}
            disabled={controlsDisabled || tool.enabledSource === 'plugin-disabled' || tool.enabledSource === 'connection-blocked'}
            aria-label={`Enable ${tool.mcpName}`}
            onCheckedChange={(checked) => {
              onOverride(tool.mcpName, { enabled: checked, confirm: tool.overrideConfirm ?? null });
            }}
          />
        </div>
        {tool.overrideEnabled !== null && tool.overrideEnabled !== undefined && (
          <button
            type='button'
            className={styles.ResetLink}
            onClick={() => {
              onOverride(tool.mcpName, { enabled: null, confirm: tool.overrideConfirm ?? null }); 
            }}
          >
            overridden · reset
          </button>
        )}
        {tool.enabledSource === 'connection-blocked' && (
          <Text size='xs' className={styles.Muted}>connection blocked</Text>
        )}
        {tool.enabledSource === 'plugin-disabled' && (
          <Text size='xs' className={styles.Muted}>plugin disabled</Text>
        )}
      </div>
      <div className={styles.ToolControl}>
        <div className={styles.Status}>
          <Text size='xs' className={styles.Muted}>Confirm</Text>
          <Switch
            size='sm'
            checked={tool.confirm}
            disabled={controlsDisabled || tool.builtIn}
            aria-label={`Confirm ${tool.mcpName}`}
            onCheckedChange={(checked) => {
              onOverride(tool.mcpName, { enabled: tool.overrideEnabled ?? null, confirm: checked });
            }}
          />
        </div>
        {tool.overrideConfirm !== null && tool.overrideConfirm !== undefined && (
          <button
            type='button'
            className={styles.ResetLink}
            onClick={() => {
              onOverride(tool.mcpName, { enabled: tool.overrideEnabled ?? null, confirm: null }); 
            }}
          >
            overridden · reset
          </button>
        )}
        {tool.confirmSource === 'global-override' && (
          <Text size='xs' className={styles.Muted}>global override</Text>
        )}
      </div>
    </div>
  );
};

export default AiToolsSettingsPage;
