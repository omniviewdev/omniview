import { Component, Suspense, useLayoutEffect, useRef, useCallback, type ReactNode } from 'react';
import { SETTINGS_EDITOR_EXTENSION_POINT_ID, useExtensionPointSnapshot, type SettingsEditorV1, type SettingsEditorProps } from '@omniviewdev/runtime';
import type { Setting } from '@omniviewdev/runtime/models';

export type PluginSettingEditorProps = Omit<SettingsEditorProps, 'setting'> & {
  pluginId: string;
  setting: Setting;
  children: ReactNode;
};

type BoundaryProps = { children: ReactNode; fallback: ReactNode; contribution: unknown; restoreFocus: () => void };

class EditorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  static getDerivedStateFromError() {
    return { failed: true }; 
  }

  state = { failed: false };

  componentDidCatch() {
    this.props.restoreFocus(); 
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.contribution !== this.props.contribution && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return <>{this.state.failed ? this.props.fallback : this.props.children}</>;
  }
}

/** The host row and draft survive editor reloads, failures, and plugin unloads. */
export function PluginSettingEditor({ pluginId, settingId, setting, children, registerFocusTarget, ...props }: PluginSettingEditorProps) {
  const { contributions } = useExtensionPointSnapshot<SettingsEditorV1>(SETTINGS_EDITOR_EXTENSION_POINT_ID);
  const matches = contributions.filter((contribution) => contribution.plugin === pluginId &&
    contribution.value?.schemaVersion === 1 && contribution.value.settingId === settingId);
  const contribution = pluginId && pluginId !== 'core' && setting.id === settingId && matches.length === 1 ? matches[0] : undefined;
  const editor: unknown = contribution?.value.editor;
  const validEditor = typeof editor === 'function' || Boolean(editor && typeof editor === 'object' &&
    ('$$typeof' in editor) && (editor.$$typeof === Symbol.for('react.memo') || editor.$$typeof === Symbol.for('react.forward_ref')));
  const root = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const focusTarget = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    if (!hadFocus.current || !document.hasFocus()) {
      return;
    }

    const target = focusTarget.current?.isConnected ? focusTarget.current :
      root.current?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),[tabindex="0"]');
    target?.focus();
  }, []);
  const attachFocus = useCallback((element: HTMLElement | null) => {
    focusTarget.current = element;
    registerFocusTarget?.(element);
    if (element) {
      restoreFocus();
    }
  }, [registerFocusTarget, restoreFocus]);
  useLayoutEffect(() => {
    restoreFocus();
    return () => {
      registerFocusTarget?.(null); 
    };
  }, [contribution, registerFocusTarget, restoreFocus]);
  const metadata: SettingsEditorProps['setting'] = {
    id: setting.id, label: setting.label, description: setting.description, type: setting.type,
    options: setting.options, fileSelection: setting.fileSelection, sensitive: setting.sensitive,
    requiresRestart: setting.requiresRestart,
  };
  const Editor = validEditor ? editor as SettingsEditorV1['editor'] : null;
  return <div ref={root} style={{ display: 'contents' }} onFocusCapture={() => {
    hadFocus.current = true; 
  }}
  onBlurCapture={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
      hadFocus.current = false;
    }
  }}>
    {validEditor && Editor ? <EditorBoundary contribution={contribution} fallback={children} restoreFocus={restoreFocus}>
      <Suspense fallback={children}>
        <Editor {...props} settingId={settingId} setting={metadata} registerFocusTarget={attachFocus} />
      </Suspense>
    </EditorBoundary> : children}
  </div>;
}
