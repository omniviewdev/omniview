import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useScopedSettings } from '@omniviewdev/runtime';
import { Button, Dialog } from '@omniviewdev/base-ui';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';

import { SettingsFormRegistration, type SettingsNavigationForm } from '@/hooks/settings/useSettingsForm';
import styles from './SettingsPage.module.css';
import { useDevMode } from '@/hooks/useDevMode';

// Components
import SettingsNav from './SettingsNav';
import CoreSettingsPage from './CoreSettingsPage';
import PluginSettingsPage from './PluginSettingsPage';
import ExtensionSettingsPage from './ExtensionSettingsPage';
import AiToolsSettingsPage from './AiToolsSettingsPage';
import { Section, SettingsCloseContext, SettingsFocusContext, type SectionSelection } from './settingsContext';

const SECTION_BY_QUERY: Record<string, Section> = {
  core: Section.Core,
  plugins: Section.Plugins,
  extensions: Section.Extensions,
  'ai-tools': Section.AITools,
};

/**
 * The main settings page for the application.
 */
export default function SettingsPage({ request, onLocationChange, onClose }: {
  request?: { target: string; requestId: number };
  onLocationChange?: (target: string, requestId: number) => void;
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const form = React.useRef<SettingsNavigationForm | null>(null);
  const [formSaving, setFormSaving] = React.useState(false);
  const register = React.useCallback((next: SettingsNavigationForm | null) => {
    form.current = next;
    setFormSaving(next?.saving ?? false);
  }, []);
  const [pending, setPending] = React.useState<null | (() => void)>(null);
  const [guardSaving, setGuardSaving] = React.useState(false);
  const [guardError, setGuardError] = React.useState('');
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const pendingAction = React.useRef<(() => void) | null>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const devMode = useDevMode();
  const [pluginResults, setPluginResults] = React.useState<Record<string, SearchItem[]>>({});
  const recordPlugin = React.useCallback((id: string, items: SearchItem[]) => {
    setPluginResults(previous => JSON.stringify(previous[id]) === JSON.stringify(items) ? previous : { ...previous, [id]: items });
  }, []);
  const [query, setQuery] = React.useState('');
  const [requestKey, setRequestKey] = React.useState(0);
  const acceptedRequest = React.useRef(0);
  const processedRequest = React.useRef<number | null>(null);
  const routingTarget = React.useRef<string | null>(null);
  const guard = React.useCallback((action: () => void) => {
    if (form.current && (form.current.hasDrafts || form.current.saving)) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      pendingAction.current = action;
      setGuardError('');
      setPending(() => action);
    } else {
      pendingAction.current = null;
      setPending(null);
      action();
    }
  }, []);
  React.useEffect(() => {
    if (!request || processedRequest.current === request.requestId) {
      return;
    }

    processedRequest.current = request.requestId;
    guard(() => {
      acceptedRequest.current = request.requestId;
      routingTarget.current = (request.target || '/settings?category=general').split('#', 1)[0];
      setRequestKey(request.requestId);
      setQuery('');
      void navigate(request.target || '/settings?category=general');
    });
  }, [request, guard, navigate]);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = /mac/i.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !modifier || event.key.toLowerCase() !== 'k') {
        return;
      }

      event.preventDefault();
      if (pendingAction.current) {
        return;
      }

      searchInput.current?.focus();
      searchInput.current?.select();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown); 
    };
  }, []);

  const cancelNavigation = () => {
    pendingAction.current = null;
    setPending(null);
    // Reject the target, not its request identity: later accepted sidebar
    // navigation must still update the backend's current request revision.
    acceptedRequest.current = request?.requestId ?? acceptedRequest.current;
    routingTarget.current = null;
    onLocationChange?.(`${location.pathname}${location.search}`, acceptedRequest.current);
    returnFocus.current?.focus();
  };

  const settings = useScopedSettings({ kind: 'host' });
  const { plugins } = usePluginManager();
  const sectionQuery = searchParams.get('section') ?? 'core';
  const section = Object.hasOwn(SECTION_BY_QUERY, sectionQuery) ? SECTION_BY_QUERY[sectionQuery] : undefined;
  const selectionParameter = section === Section.Plugins ? 'plugin' : 'category';
  const specialId = section === Section.Extensions ? 'extensions' : section === Section.AITools ? 'ai-tools' : null;
  const id = specialId ?? (searchParams.get(selectionParameter) ?? 'general');
  const focusTarget = searchParams.get('setting');
  const focusRequest = React.useMemo(
    () => (focusTarget === null ? null : { settingId: focusTarget, requestKey: `${location.key}:${requestKey}` }),
    [focusTarget, location.key, requestKey],
  );
  const validSection = section !== undefined;
  const malformed =
    !validSection ||
    id.length > 256 ||
    (focusTarget !== null && (!focusTarget || focusTarget.length > 256 || !id || specialId !== null || (section === Section.Core && (id === 'ai-tools' || id === 'extensions'))));
  const selected: SectionSelection = { section: section ?? Section.Core, id };
  const loading =
    (section === Section.Core && settings.isLoading) || (section === Section.Plugins && plugins.isLoading);
  const missing =
    Boolean(id) &&
    ((section === Section.Core &&
      id !== 'extensions' &&
      id !== 'ai-tools' &&
      !Object.values(settings.categories).some((category) => category?.id === id)) ||
      (section === Section.Plugins && !plugins.data?.some((plugin) => plugin.id === id)));
  const unavailable = malformed || (!loading && missing) || (section === Section.Plugins && !id);
  const navSelection = specialId !== null ? { section: Section.Core, id: specialId } : selected;
  React.useEffect(() => {
    const target = `${location.pathname}${location.search}`;
    if (routingTarget.current && routingTarget.current !== target) {
      return;
    }

    routingTarget.current = null;
    onLocationChange?.(target, acceptedRequest.current);
  }, [location.pathname, location.search, requestKey, onLocationChange]);

  function select(next: SectionSelection) {
    const params = new URLSearchParams();
    if (next.section === Section.Extensions || (next.section === Section.Core && next.id === 'extensions')) {
      params.set('section', Section.Extensions);
    } else if (next.section === Section.AITools || (next.section === Section.Core && next.id === 'ai-tools')) {
      params.set('section', Section.AITools);
    } else {
      params.set('section', next.section);
      params.set(next.section === Section.Plugins ? 'plugin' : 'category', next.id);
    }

    guard(() => {
      setQuery(''); setSearchParams(params); 
    });
  }

  let content: React.ReactNode;
  if (unavailable) {
    content = <p role='status'>Requested settings are unavailable.</p>;
  } else if (loading) {
    content = <p role='status'>Loading settings…</p>;
  } else {
    content = GetSettingsPage(selected.section, selected.id);
  }

  const results = Object.values(settings.categories).flatMap(category => !category ? [] :
    Object.entries(category.settings).flatMap(([key, setting]) => !setting || (setting.devOnly && !devMode) ? [] : [{
      id: `${category.id}.${key}`, label: setting.label, description: setting.description, category: category.label,
      target: `/settings?category=${encodeURIComponent(category.id)}&setting=${encodeURIComponent(`${category.id}.${key}`)}`,
    }])).concat((plugins.data ?? []).flatMap(plugin => pluginResults[plugin.id] ?? []))
    .filter(item => `${item.id} ${item.label} ${item.description} ${item.category}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <SettingsFormRegistration.Provider value={register}>
      <SettingsCloseContext.Provider value={onClose}>
        {(plugins.data ?? []).map(plugin => <PluginSearchIndex key={plugin.id} id={plugin.id} label={plugin.metadata.name} devMode={devMode} onIndex={recordPlugin} />)}
        <div className={styles.Window}>
          <aside className={styles.Sidebar}>
            <div className={styles.Brand}>Settings</div>
            <input ref={searchInput} className={styles.Search} type='search' aria-label='Search settings' aria-keyshortcuts='Meta+K Control+K' placeholder='Search settings' value={query} onChange={event => {
              setQuery(event.target.value); 
            }} />
            <SettingsNav selected={navSelection} onChange={select} />
          </aside>
          <main className={styles.Main}>
            <button className={styles.Close} aria-label='Close settings' onClick={onClose}>×</button>
            <div className={styles.Content} style={query ? { display: 'none' } : undefined}>
              <SettingsFocusContext.Provider value={focusRequest}>{content}</SettingsFocusContext.Provider>
            </div>
            {query && <div className={styles.Results}><h1>Search results</h1>
              {results.map(result => <button key={result.target} onClick={() => {
                guard(() => {
                  setQuery(''); void navigate(result.target);
                }); 
              }}>
                <small>{result.category}</small>{' '}<strong>{result.label}</strong><span>{result.description}</span>
              </button>)}
              {!results.length && <p role='status'>No matching settings.</p>}
            </div>}
          </main>
          {pending && <Dialog open size='sm' onClose={() => {
            if (!guardSaving) {
              cancelNavigation();
            }
          }} onKeyDown={event => {
            if (event.key === 'Tab') {
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = current < 0
                ? (event.shiftKey ? buttons.length - 1 : 0)
                : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
              event.preventDefault(); buttons[next]?.focus();
            }
          }}>
            <Dialog.Title>Save your changes?</Dialog.Title>
            <Dialog.Body>
              <p>Save or discard unsaved changes before switching settings.</p>
              {guardError && <p role='alert'>{guardError}</p>}
            </Dialog.Body>
            <Dialog.Footer>
              <Button color='neutral' variant='ghost' disabled={guardSaving} onClick={cancelNavigation}>Cancel</Button>
              <Button color='neutral' variant='soft' disabled={guardSaving || formSaving} onClick={() => {
                form.current?.discard(); const action = pendingAction.current; pendingAction.current = null; setPending(null); action?.();
              }}>Discard</Button>
              <Button color='brand' variant='soft' disabled={guardSaving || formSaving} onClick={async () => {
                setGuardSaving(true);
                const saved = await form.current?.save();
                setGuardSaving(false);
                if (saved) {
                  const action = pendingAction.current; pendingAction.current = null; setPending(null); action?.();
                } else {
                  setGuardError('Changes could not be saved. Resolve the errors or discard changes.');
                }
              }}>Save changes</Button>
            </Dialog.Footer>
          </Dialog>}
        </div>
      </SettingsCloseContext.Provider>
    </SettingsFormRegistration.Provider>
  );
}

type SearchItem = { id: string; label: string; description: string; category: string; target: string };

function PluginSearchIndex({ id, label, devMode, onIndex }: {
  id: string; label: string; devMode: boolean; onIndex: (id: string, items: SearchItem[]) => void;
}) {
  const scoped = useScopedSettings({ kind: 'plugin', pluginId: id });
  React.useEffect(() => {
    const items = Object.values(scoped.categories).flatMap(category => !category ? [] :
      Object.entries(category.settings).flatMap(([key, setting]) => !setting || (setting.devOnly && !devMode) ? [] : [{
        id: key, label: setting.label, description: setting.description, category: label,
        target: `/settings?section=plugins&plugin=${encodeURIComponent(id)}&setting=${encodeURIComponent(key)}`,
      }]));
    onIndex(id, items);
  }, [id, label, devMode, scoped.categories, onIndex]);
  return null;
}

const GetSettingsPage = (section: Section, id: string) => {
  if (!id) {
    return <></>;
  }

  switch (section) {
    case Section.Core:
      switch (id) {
        case 'extensions':
          return <ExtensionSettingsPage />;
        case 'ai-tools':
          return <AiToolsSettingsPage />;
        default:
          return <CoreSettingsPage key={`core:${id}`} id={id} />;
      }

    case Section.Plugins:
      return <PluginSettingsPage key={`plugins:${id}`} id={id} />;
    case Section.Extensions:
      return <ExtensionSettingsPage />;
    case Section.AITools:
      return <AiToolsSettingsPage />;
  }
};
