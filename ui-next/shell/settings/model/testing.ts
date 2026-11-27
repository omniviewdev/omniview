import type { SettingsSession } from './session';
import type { HostCategory, HostCommit, HostOption, HostSetting, HostSettingType, HostSnapshot, HostValidation, SettingsClient, SettingsRequest, SettingsWindowClient } from './types';

// Test support only: nothing in the model imports this file. A host snapshot built as plain data, with the host's own categories as the Go side declares them today (`internal/settings/{general,appearance,terminal,
// editor,developer,telemetry}.go`: ids, types, labels, descriptions, options and defaults), and a client that answers from memory, the way the host's settings service does (`backend/pkg/settings/service.go`).

type Extra = Partial<Omit<HostSetting, 'id' | 'type' | 'label' | 'description' | 'default' | 'value'>>;

const opts = (...pairs: ReadonlyArray<readonly [string, string]>): readonly HostOption[] => pairs.map(([value, label]) => ({ value, label, description: '' }));

/** One declared setting, as the host sends it in a snapshot: its value is its default until a test says otherwise, and a sensitive one has neither (the host blanks both). */
export function setting(id: string, type: HostSettingType, label: string, description: string, fallback: unknown, extra: Extra = {}): HostSetting {
  const sensitive = extra.sensitive === true || type === 'password';
  return {
    id,
    type,
    label,
    description,
    value: sensitive ? null : fallback,
    default: sensitive ? null : fallback,
    options: sensitive ? [] : (extra.options ?? []),
    fileSelection: sensitive ? null : (extra.fileSelection ?? null),
    sensitive,
    devOnly: false,
    requiresRestart: false,
    pendingRestart: false,
    ...extra,
  };
}

export function category(id: string, label: string, description: string, icon: string, settings: readonly HostSetting[]): HostCategory {
  return { id, label, description, icon, settings: Object.fromEntries(settings.map((entry) => [entry.id, entry])) };
}

const file = { enabled: true, allowFolders: false, multiple: false, extensions: [] as readonly string[], relative: false };

export const GENERAL = category('general', 'General', 'General settings for the application', 'LuSettings2', [
  setting('language', 'text', 'Language', 'The language to use when displaying text', 'en', { options: opts(['en', 'English'], ['es', 'Spanish']) }),
]);

export const APPEARANCE = category('appearance', 'Appearance', 'Customize the look and feel of the application', 'LuPaintbrush', [
  setting('windowMaterial', 'text', 'Material', '', 'opaque', { options: opts(['opaque', 'Opaque'], ['translucent', 'Translucent'], ['glass', 'Liquid Glass']) }),
  setting('glassStyle', 'text', 'Glass style', '', 'regular', { options: opts(['regular', 'Regular'], ['clear', 'Clear']) }),
  setting('chromeOpacity', 'integer', 'Window chrome', '', 62),
  setting('contentOpacity', 'integer', 'Content', '', 94),
  setting('menuOpacity', 'integer', 'In-app menus', '', 90),
  setting('sheetOpacity', 'integer', 'Sheets and dialogs', '', 96),
  setting('theme', 'text', 'Theme', 'The color theme for the application UI', 'void'),
  setting('density', 'text', 'UI Density', 'Choose comfortable spacing or a compact layout.', 'comfortable', { options: opts(['comfortable', 'Comfortable'], ['compact', 'Compact']) }),
  setting('textSize', 'text', 'UI Text Size', 'Scale interface text independently of density. Terminal and code editor fonts stay unchanged.', '100', {
    options: opts(['80', '80%'], ['90', '90%'], ['100', '100%'], ['110', '110%'], ['125', '125%']),
  }),
  setting('motion', 'text', 'Motion', 'Follow the system accessibility preference or choose animation behavior.', 'system', { options: opts(['system', 'Follow System'], ['normal', 'Normal'], ['reduced', 'Reduced']) }),
]);

export const TERMINAL = category('terminal', 'Terminal', 'Customize the behavior of the terminal', 'LuSquareTerminal', [
  setting('nativeApplication', 'text', 'Native Terminal Application', 'macOS application for a fresh external resource shell. Built-in terminals are unchanged.', 'terminal'),
  setting('defaultShell', 'text', 'Default Shell', 'The default shell to use when opening a terminal', '/bin/zsh'),
  setting('shellIntegration', 'toggle', 'Shell Integration', 'Let the shell tell the terminal where each command starts and ends, and in which directory. Applies to terminals opened after the change; the shell\'s startup files are never edited.', true),
  setting('theme', 'text', 'Theme', 'The color theme for the terminal', 'application', {
    options: opts(['application', 'Application'], ['dracula', 'Dracula'], ['solarized-dark', 'Solarized Dark'], ['solarized-light', 'Solarized Light'], ['nord', 'Nord'], ['one-light', 'One Light']),
  }),
  setting('fontSize', 'integer', 'Font Size', 'The size of the font in the terminal', 12),
  setting('cursorStyle', 'text', 'Cursor Style', 'The style of the cursor in the terminal', 'block', { options: opts(['block', 'Block'], ['underline', 'Underline'], ['bar', 'Bar']) }),
  setting('cursorBlink', 'toggle', 'Cursor Blink', 'Whether the cursor should blink in the terminal', true),
]);

export const EDITOR = category('editor', 'Editor', 'Change settings within the code editor', 'LuCode', [
  setting('theme', 'text', 'Theme', 'The color theme for the editor', 'application', { options: opts(['application', 'Application'], ['brilliance-black', 'Brilliance Black'], ['github-dark', 'GitHub Dark']) }),
  setting('folding', 'toggle', 'Folding', 'Enable code folding. Defaults to true.', true),
  setting('foldingHighlight', 'toggle', 'Folding Highlight', 'Enable highlight for folded regions. Defaults to true.', true),
  setting('fontSize', 'integer', 'Font Size', 'The size of the font in the editor.', 11),
  setting('fontWeight', 'text', 'Font Weight', 'The font weight.', 'normal'),
  setting('formatOnPaste', 'toggle', 'Format On Paste', 'Enable format on paste. Defaults to false.', false),
  setting('formatOnType', 'toggle', 'Format On Type', 'Enable format on type. Defaults to false.', false),
  setting('lineHeight', 'integer', 'Line Height', 'The line height.', 1),
  setting('lineNumbers', 'text', 'Line Numbers', 'Control the rendering of line numbers. Defaults to \'on\'.', 'on', { options: opts(['on', 'On'], ['off', 'Off'], ['relative', 'Relative'], ['interval', 'Interval']) }),
  setting('lineNumbersMinChars', 'integer', 'Line Number Width', 'Control the width of line numbers, by reserving horizontal space for rendering at least an amount of digits. Defaults to 5.', 5),
  setting('minimapEnabled', 'toggle', 'Minimap Enabled', 'Enable the rendering of the minimap. Defaults to \'true\'', true),
  setting('minimapScale', 'integer', 'Minimap Scale', 'Relative size of the font in the minimap. Defaults to 1.', 1),
  setting('minimapShowSlider', 'text', 'Minimap Slider', 'Control the rendering of the minimap slider. Defaults to \'mouseover\'.', 'mouseover', { options: opts(['mouseover', 'Mouseover'], ['always', 'Always']) }),
  setting('minimapSide', 'text', 'Minimap Side', 'Control the side of the minimap in editor. Defaults to \'right\'', 'right', { options: opts(['right', 'Right'], ['left', 'Left']) }),
  setting('minimapSize', 'text', 'Minimap Size', 'Control the minimap rendering mode. Defaults to \'actual\'.', 'actual', { options: opts(['actual', 'Actual'], ['proportional', 'Proportional'], ['fill', 'Fill'], ['fit', 'Fit']) }),
]);

export const DEVELOPER = category('developer', 'Developer Settings', 'Settings for developing or writing plugins within Omniview', 'LuBeaker', [
  setting('show_feature_channels', 'toggle', 'Show feature channels', 'List feature branch release channels for the app and plugins.', false),
  setting('ui_inspection_enabled', 'toggle', 'UI inspection (WebKit)', 'Inspect this app from Safari Develop after restarting. Captures can expose sensitive application data.', false, { requiresRestart: true }),
  setting('pprof_enabled', 'toggle', 'Enable local pprof', 'Enable unauthenticated profiling on 127.0.0.1 after restarting Omniview. Captures can expose sensitive process data. Do not forward this endpoint.', false, { requiresRestart: true }),
  setting('plugin_pprof_enabled', 'toggle', 'Enable plugin pprof', 'Enable unauthenticated plugin profiling on 127.0.0.1 after restarting Omniview. Captures can expose sensitive process data. Do not forward these endpoints.', false, { requiresRestart: true }),
  setting('pprof_port', 'integer', 'Host profiling port', 'Local pprof port after restarting Omniview. Use 0 to select an available port.', 6060, { requiresRestart: true }),
  setting('marketplace_url', 'text', 'Marketplace URL', 'Base URL for the plugin marketplace API. Change this to point to a staging or self-hosted instance.', 'https://mkt.omniview.dev'),
  setting(
    'registry_public_key',
    'text',
    'Marketplace Signing Key',
    'Hex-encoded Ed25519 public key used to verify plugin artifacts. Leave empty to use the built-in key; set it when the marketplace URL points to a staging or self-hosted instance that signs with its own key.',
    '',
  ),
  setting('gopath', 'text', 'Go Path', 'Path to the Go binary', '', { fileSelection: file }),
  setting('pnpmpath', 'text', 'PNPM Path', 'PNPM binary for standalone plugin development. Named workspaces require their owned launcher; select native pnpm with OMNIVIEW_PNPM_EXECUTABLE when starting the workspace instead.', '', { fileSelection: file }),
  setting('nodepath', 'text', 'Node Path', 'Path to the Node binary', '', { fileSelection: file }),
]);

export const TELEMETRY = category('telemetry', 'Telemetry', 'Configure observability, logging, tracing, metrics, and profiling', 'LuActivity', [
  setting('enabled', 'toggle', 'Enable Telemetry', 'Master switch for all telemetry export. When off, no data is shipped externally.', false),
  setting('client_id', 'text', 'Client ID', 'Optional installation identifier included in exported telemetry. Use only non-sensitive values. Changes require restart.', '', { requiresRestart: true }),
  setting('traces', 'toggle', 'Traces', 'Enable distributed tracing via OpenTelemetry', true),
  setting('metrics', 'toggle', 'Metrics', 'Enable metrics collection via OpenTelemetry', true),
  setting('logs_ship', 'toggle', 'Ship Logs', 'Ship host logs using the selected log format. Local logs are always written.', true),
  setting('logs_format', 'text', 'Log Export Format', 'Choose OTLP or the native Loki push API for shipped host logs.', 'otlp', { options: opts(['otlp', 'OpenTelemetry (OTLP)'], ['loki', 'Loki']) }),
  setting('logs_ship_level', 'text', 'Log Ship Level', 'Minimum log level to ship externally', 'warn', { options: opts(['debug', 'debug'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']) }),
  setting('profiling', 'toggle', 'Continuous Profiling', 'Enable continuous profiling via Pyroscope (CPU, memory, goroutines)', false),
  setting('endpoint_otlp', 'text', 'OTLP Traces and Metrics Endpoint', 'OTLP HTTP endpoint for traces and metrics (e.g., localhost:4318). Also used for OTLP logs when the OTLP log endpoint is empty.', ''),
  setting('endpoint_otlp_logs', 'text', 'OTLP Log Endpoint', 'Optional OTLP HTTP endpoint for logs. When empty, logs reuse the traces and metrics endpoint and authentication.', ''),
  setting('otlp_logs_tenant_id', 'text', 'OTLP Log Tenant ID', 'Optional X-Scope-OrgID header for OTLP logs.', ''),
  setting('otlp_logs_auth_header', 'text', 'OTLP Log Auth Header', 'Optional HTTP authentication header name for a separate OTLP log endpoint.', ''),
  setting('otlp_logs_auth_value', 'password', 'OTLP Log Auth Value', 'Optional HTTP authentication header value for a separate OTLP log endpoint.', '', { sensitive: true }),
  setting('endpoint_loki', 'text', 'Loki Log Endpoint', 'Full Loki push URL, for example https://loki.example.com/loki/api/v1/push. Required when shipping logs in Loki format.', ''),
  setting('loki_tenant_id', 'text', 'Loki Tenant ID', 'Optional Loki tenant sent in the X-Scope-OrgID header.', ''),
  setting('loki_auth_header', 'text', 'Loki Auth Header', 'Optional HTTP authentication header name for Loki.', ''),
  setting('loki_auth_value', 'password', 'Loki Auth Value', 'Optional HTTP authentication header value for Loki.', '', { sensitive: true }),
  setting('endpoint_pyroscope', 'text', 'Pyroscope Endpoint', 'Pyroscope endpoint for continuous profiling (e.g., localhost:4040)', ''),
  setting('auth_header', 'text', 'OTLP Traces and Metrics Auth Header', 'HTTP authentication header name for traces and metrics. Also used for OTLP logs when the OTLP log endpoint is empty.', ''),
  setting('auth_value', 'password', 'OTLP Traces and Metrics Auth Value', 'HTTP authentication header value for traces and metrics. Also used for OTLP logs when the OTLP log endpoint is empty.', '', { sensitive: true }),
]);

/** The host's own categories, in the order the Go side lists them (`Definitions`). */
export const HOST_CATEGORIES: readonly HostCategory[] = [GENERAL, APPEARANCE, TERMINAL, EDITOR, DEVELOPER, TELEMETRY];

/** The snapshot of a host with none of the settings changed and no secret stored. */
export function hostSnapshot(overrides: Readonly<Record<string, unknown>> = {}, stored: Readonly<Record<string, boolean>> = {}): HostSnapshot {
  const categories: Record<string, HostCategory> = {};
  const facts: Record<string, boolean> = {};
  for (const entry of HOST_CATEGORIES) {
    const settings: Record<string, HostSetting> = {};
    for (const [id, one] of Object.entries(entry.settings)) {
      if (one === undefined) {
        continue;
      }

      const key = `${entry.id}.${id}`;
      const sensitive = one.sensitive === true || one.type === 'password';
      settings[id] = sensitive || !Object.hasOwn(overrides, key) ? one : { ...one, value: overrides[key] };
      if (sensitive) {
        facts[key] = stored[key] ?? false;
      }
    }

    categories[entry.id] = { ...entry, settings };
  }

  return { categories, stored: facts };
}

export type FakeHost = {
  readonly client: SettingsClient;
  /** What the host holds now, by the id a commit takes (a secret's value is here and nowhere a snapshot reaches). */
  readonly values: Map<string, unknown>;
  readonly calls: { snapshot: number; readonly validate: Array<readonly [string, unknown]>; readonly commit: Array<Readonly<Record<string, unknown>>> };
  /** Someone else changes a setting (another window, an agent): the host says so to every listener. */
  readonly change: (id: string, value: unknown) => void;
  /** The listeners that are registered now. */
  readonly listeners: () => number;
  /** The page's events connection came back: what was told while it was down is not replayed. */
  readonly reconnect: () => void;
  /** The listeners of the reconnect signal that are registered now. */
  readonly reconnectListeners: () => number;
  /** What the next validation or commit answers, once. */
  readonly next: { validate?: (id: string, value: unknown) => Promise<HostValidation> | HostValidation; commit?: (values: Readonly<Record<string, unknown>>) => Promise<HostCommit> | HostCommit; snapshot?: () => Promise<HostSnapshot> };
  readonly pendingRestart: Set<string>;
};

/** A host settings service in memory: the snapshot reflects every commit, a validation answers valid unless a test says otherwise, and `change` notifies as the real host's `settings/changed` does. */
export function fakeHost(initial: Readonly<Record<string, unknown>> = {}, stored: Readonly<Record<string, boolean>> = {}): FakeHost {
  const values = new Map<string, unknown>(Object.entries(initial));
  const secrets = new Map<string, boolean>(Object.entries(stored));
  const listeners = new Set<() => void>();
  const reconnects = new Set<() => void>();
  const pendingRestart = new Set<string>();
  const calls: FakeHost['calls'] = { snapshot: 0, validate: [], commit: [] };
  const next: FakeHost['next'] = {};
  const snapshot = (): HostSnapshot => {
    const base = hostSnapshot(Object.fromEntries(values), Object.fromEntries(secrets));
    for (const [, one] of Object.entries(base.categories)) {
      for (const [id, entry] of Object.entries(one?.settings ?? {})) {
        if (one !== undefined && entry !== undefined && pendingRestart.has(`${one.id}.${id}`)) {
          (one.settings as Record<string, HostSetting>)[id] = { ...entry, pendingRestart: true };
        }
      }
    }

    return base;
  };

  const client: SettingsClient = {
    snapshot: async () => {
      calls.snapshot += 1;
      const answer = next.snapshot;
      next.snapshot = undefined;
      return answer === undefined ? snapshot() : answer();
    },
    validate: async (id, value) => {
      calls.validate.push([id, value]);
      const answer = next.validate;
      next.validate = undefined;
      return answer === undefined ? { valid: true } : answer(id, value);
    },
    commit: async (given) => {
      calls.commit.push({ ...given });
      const answer = next.commit;
      next.commit = undefined;
      if (answer !== undefined) {
        return answer(given);
      }

      for (const [id, value] of Object.entries(given)) {
        const one = hostSnapshot().categories[id.split('.')[0] ?? '']?.settings[id.split('.').slice(1).join('.')];
        if (one?.sensitive === true || one?.type === 'password') {
          secrets.set(id, value !== '' && value !== null);
        }

        values.set(id, value);
        if (one?.requiresRestart === true) {
          pendingRestart.add(id);
        }
      }

      for (const listener of [...listeners]) {
        listener();
      }

      return { snapshot: snapshot(), applied: true, uncertain: false, message: '' };
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReconnect: (listener) => {
      reconnects.add(listener);
      return () => {
        reconnects.delete(listener);
      };
    },
  };

  return {
    client,
    values,
    calls,
    change: (id, value) => {
      values.set(id, value);
      for (const listener of [...listeners]) {
        listener();
      }
    },
    listeners: () => listeners.size,
    reconnect: () => {
      for (const listener of [...reconnects]) {
        listener();
      }
    },
    reconnectListeners: () => reconnects.size,
    next,
    pendingRestart,
  };
}

/** A session that does nothing and can be disposed: what a test of the control (which only makes and disposes one) holds. */
export function fakeSession(dispose: () => void = () => undefined): SettingsSession {
  return {
    getState: () => ({ phase: 'loading' }),
    subscribe: () => () => undefined,
    load: () => undefined,
    refresh: () => undefined,
    resetMaterial: async () => false,
    elsewhere: { getSnapshot: () => ({}), subscribe: () => () => undefined },
    announcements: { getSnapshot: () => ({ text: '', serial: 0 }), subscribe: () => () => undefined },
    dispose,
  };
}

export type FakeWindows = {
  readonly client: SettingsWindowClient;
  /** The host's event: a request to show Settings, or a show or a hide. */
  readonly emit: (request: SettingsRequest) => void;
  readonly calls: { hide: number; state: number };
  /** What `GetSettingsState` answers. */
  state: SettingsRequest;
  /** Settles `GetSettingsState` and `HideSettings` by failing, for a test. */
  failHide: boolean;
};

/** The host's window service as the Settings window reads it, answering from memory: the request it was last given, the event of each one, and a count of the hides. */
export function fakeWindows(initial: SettingsRequest = { requestId: 1, target: '/settings?category=general', visible: true }): FakeWindows {
  const listeners = new Set<(request: SettingsRequest) => void>();
  const windows: FakeWindows = {
    calls: { hide: 0, state: 0 },
    state: initial,
    failHide: false,
    emit: (request) => {
      windows.state = request;
      for (const listener of [...listeners]) {
        listener(request);
      }
    },
    client: {
      state: async () => {
        windows.calls.state += 1;
        return windows.state;
      },
      onState: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      hide: async () => {
        windows.calls.hide += 1;
        if (windows.failHide) {
          throw new Error('the host could not hide it');
        }
      },
    },
  };
  return windows;
}
