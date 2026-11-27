import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button, Field, Select, TextInput, ThemeProvider,
  DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES, THEMES,
  type Density, type TextSize, type ThemeId, type TokenName,
} from '@omniviewdev/kit';
import '@omniviewdev/kit/styles.css';
import { guidance } from '../content/catalog';
import type { PropGroup } from '../scripts/props';
import type { TokenUse } from '../scripts/tokenUsage';
import { HighlightedCode } from './HighlightedCode';
import { Preview, type Appearance, type TokenValues } from './Preview';
import { PropsReference } from './PropsReference';
import { ComponentRail, LibraryFinder, componentHref } from './LibraryFinder';
import './docs.css';
import './component-surface.css';
import './library-finder.css';

type Example = { group: string; name: string; source: string; caption?: string };
type CatalogPart = { examples: Example[]; propGroups: PropGroup[]; tokenUsage: TokenUse[] };
type Catalog = { revision: string; parts: Record<string, CatalogPart> };
type SourceFile = { name: string; code: string };

async function fetchJSON<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function useJSON<T>(path: string) {
  const [result, setResult] = useState<{ data: T } | { error: true }>();
  useEffect(() => {
    const controller = new AbortController();
    fetchJSON<T>(path, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ data }); },
      () => { if (!controller.signal.aborted) setResult({ error: true }); },
    );
    return () => controller.abort();
  }, [path]);
  return result;
}

const displayName = (name: string) => name
  .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .replace(/([a-zA-Z])(\d)/g, '$1 $2');

function readComponent() {
  return new URLSearchParams(window.location.search).get('component');
}

const defaultAppearance: Appearance = { theme: DEFAULT_THEME_ID, density: DEFAULT_DENSITY, textSize: DEFAULT_TEXT_SIZE };
const themeOptions = THEMES.map(({ id, name }) => ({ value: id, label: name }));
const densityOptions = DENSITIES.map((density) => ({ value: density, label: density[0].toUpperCase() + density.slice(1) }));
const textSizeOptions = TEXT_SIZES.map((size) => ({ value: size, label: `${size}%` }));

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  return (
    <div className="copy-control">
      <Button onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus('Copied');
        } catch {
          setStatus('Clipboard unavailable. Select and copy the code.');
        }
      }}>{label}</Button>
      <span aria-live="polite" className="copy-status">{status}</span>
    </div>
  );
}

// Stylesheets can use a token as one component of a shorthand. Validate the
// token itself, not the full declaration that happens to consume it.
function tokenValueProperty(name: TokenName) {
  if (name === '--ov-font-features') return 'font-feature-settings';
  if (name.startsWith('--ov-font-')) return 'font-family';
  if (name === '--ov-text-scale') return 'scale';
  if (name.startsWith('--ov-fs-')) return 'font-size';
  if (name.startsWith('--ov-lh-')) return 'line-height';
  if (name.startsWith('--ov-radius-')) return 'border-top-left-radius';
  if (name.startsWith('--ov-shadow-')) return 'box-shadow';
  if (name.startsWith('--ov-spacing-') || name === '--ov-row-pad') return 'padding-top';
  if (name.endsWith('-height') || name === '--ov-row-target') return 'height';
  return 'color';
}

const tokenUseLabels: Record<TokenUse['kind'], string> = {
  direct: 'Direct',
  shared: 'Shared',
  composed: 'Composed',
};

function Inspector({ part, revision, tokenUses, tokenNames, resolved, overrides, setOverrides }: {
  part: string;
  revision: string;
  tokenUses: TokenUse[];
  tokenNames: readonly TokenName[];
  resolved: TokenValues;
  overrides: TokenValues;
  setOverrides: (values: TokenValues) => void;
}) {
  const [tokenName, setTokenName] = useState<TokenName>(tokenNames[0]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const valueProperty = tokenValueProperty(tokenName);
  const sourceRoot = `https://github.com/omniviewdev/omniview/blob/${revision}/packages/kit`;
  const evidence = tokenUses.filter(({ name }) => name === tokenName);
  const active = overrides[tokenName];
  const value = resolved[tokenName];
  const edits = tokenNames.flatMap((name) => overrides[name] === undefined ? [] : [`  ${name}: ${overrides[name]};`]);
  const css = `[data-kit-preview] {\n${edits.join('\n')}\n}\n`;

  function apply(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || /[;{}]/.test(next) || !CSS.supports(valueProperty, next)) {
      setError(`Enter a valid CSS ${valueProperty} value.`);
      return;
    }
    setOverrides({ ...overrides, [tokenName]: next });
    setError('');
  }

  return (
    <div className="inspector panel">
      <form ref={formRef} className="token-form" onSubmit={apply}>
        <Field label={`${part} token`} layout="stacked">
          <Select value={tokenName} options={tokenNames.map((name) => ({ value: name, label: name }))} onValueChange={(value) => {
            const name = value as TokenName;
            setTokenName(name);
            setDraft(overrides[name] ?? '');
            setError('');
          }} />
        </Field>
        <p className="token-role">Override input accepts a CSS <code>{valueProperty}</code> value.</p>
        <div className="token-reading">
          <span>{active === undefined ? 'Current value' : 'Overridden value'}</span>
          <output className="token-value" aria-live="polite">
            {valueProperty === 'color' && value && <span className="swatch" style={{ backgroundColor: value }} aria-hidden="true" />}
            <code>{value || '—'}</code>
          </output>
        </div>
        <Field label="Override value" layout="stacked" message={error ? { kind: 'error', text: error } : undefined}>
          <TextInput value={draft} placeholder={value || undefined} onCommit={() => formRef.current?.requestSubmit()} onValueChange={(value) => {
            setDraft(value);
            setError('');
          }} />
        </Field>
        <span className="sr-only" role="alert">{error}</span>
        <div className="actions">
          <Button variant="primary" onClick={(event) => event.currentTarget.form?.requestSubmit()}>Apply override</Button>
          <Button disabledReason={active === undefined ? 'This token has no override.' : undefined} onClick={() => {
            const next = { ...overrides };
            delete next[tokenName];
            setOverrides(next);
            setDraft('');
            setError('');
          }}>Remove override</Button>
        </div>
      </form>
      <div className="overrides">
        <div className="overrides-heading">
          <h3>Preview overrides <span className="count">{edits.length}</span></h3>
          <Button disabledReason={edits.length ? undefined : 'There are no overrides to reset.'} onClick={() => {
            setOverrides({});
            setDraft('');
            setError('');
          }}>Reset overrides</Button>
        </div>
        {edits.length > 0 ? (
          <>
            <p>Copy these declarations to a scoped stylesheet. Replace the selector with your own preview scope.</p>
            <HighlightedCode code={css} fileName="overrides.css" label="CSS overrides" className="export-code" />
            <div className="actions">
              <CopyButton key={css} text={css} label="Copy CSS overrides" />
              <a className="text-link" href={`data:text/css;charset=utf-8,${encodeURIComponent(css)}`} download={`${part.toLowerCase()}-preview.css`}>Download CSS</a>
            </div>
          </>
        ) : <p className="empty-state">No overrides. Add a CSS value to see a scoped export here.</p>}
      </div>
      <div className="token-evidence">
        <h3>Source uses <span className="count">{evidence.length}</span></h3>
        <p className="token-role">Direct uses are in this component’s styles, shared uses come from shared rules, and composed uses come from other Kit components it renders.</p>
        <ul className="token-use-list" role="list">
          {evidence.map(({ kind, path, selector, property }) => (
            <li key={`${kind}:${path}:${selector}:${property}`}>
              <span className="token-kind">{tokenUseLabels[kind]}</span>
              <code>{property}</code>
              <code>{selector}</code>
              <a href={`${sourceRoot}/${path.split('/').map(encodeURIComponent).join('/')}`}><code>{path}</code></a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ExampleSource({ path }: { path: string }) {
  const result = useJSON<{ files: SourceFile[] }>(`./${path}`);
  const [fileIndex, setFileIndex] = useState(0);
  const file = result && 'data' in result ? result.data.files[fileIndex] : undefined;
  return (
    <div className="source panel">
      <div className="source-heading">
        <p className="eyebrow">{file?.name ?? 'Example source'}</p>
        {file && <CopyButton key={file.name} text={file.code} label={`Copy ${file.name}`} />}
      </div>
      {!result ? <p className="inline-status" role="status">Loading example source…</p>
        : file && 'data' in result ? (
          <>
            {result.data.files.length > 1 && (
              <div className="source-file">
                <Field label="Source file" layout="stacked">
                  <Select
                    value={String(fileIndex)}
                    options={result.data.files.map(({ name }, index) => ({ value: String(index), label: name }))}
                    onValueChange={(value) => setFileIndex(Number(value))}
                  />
                </Field>
              </div>
            )}
            <HighlightedCode code={file.code} fileName={file.name} />
          </>
        ) : <p className="inline-status" role="alert">Example source unavailable.</p>}
    </div>
  );
}

const componentSections = [
  ['playground', 'Playground'],
  ['source', 'Source'],
  ['tokens', 'Tokens'],
  ['props', 'Props'],
  ['usage', 'Usage'],
] as const;

type ComponentSection = (typeof componentSections)[number][0];

function sectionForHash(hash: string): ComponentSection {
  return componentSections.find(([id]) => `#${id}` === hash)?.[0] ?? 'playground';
}

function useComponentSection() {
  const [hash, setHash] = useState(() => window.location.hash);
  const section = sectionForHash(hash);
  const previousHash = useRef(hash);

  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    function syncSection() {
      setHash(window.location.hash);
    }
    window.addEventListener('popstate', syncSection);
    window.addEventListener('hashchange', syncSection);
    return () => {
      history.scrollRestoration = previousRestoration;
      window.removeEventListener('popstate', syncSection);
      window.removeEventListener('hashchange', syncSection);
    };
  }, []);

  useLayoutEffect(() => {
    const changed = previousHash.current !== hash;
    previousHash.current = hash;
    if (hash === '#main') return;
    if (hash === '#live-preview') {
      document.getElementById('live-preview')?.scrollIntoView({ behavior: 'instant', block: 'start' });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (changed) document.getElementById(`${section}-title`)?.focus({ preventScroll: true });
  }, [hash, section]);

  function navigateSection(event: MouseEvent<HTMLAnchorElement>, next: ComponentSection) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    const nextHash = `#${next}`;
    if (window.location.hash === nextHash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById(`${next}-title`)?.focus({ preventScroll: true });
      return;
    }
    history.pushState(null, '', nextHash);
    setHash(nextHash);
  }

  return { section, navigateSection };
}

function ComponentDoc({ part, revision, catalogPart, appearance, setAppearance }: {
  part: string;
  revision: string;
  catalogPart: CatalogPart;
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
}) {
  const guide = guidance[part];
  const { examples, propGroups, tokenUsage } = catalogPart;
  const { section, navigateSection } = useComponentSection();
  const tokenNames = useMemo(() => [...new Set(tokenUsage.map(({ name }) => name))], [tokenUsage]);
  const [exampleIndex, setExampleIndex] = useState(() => {
    const standard = examples.findIndex(({ group, name }) => group === part && name === 'Default');
    if (standard >= 0) return standard;
    const primary = examples.findIndex(({ group, name }) => group === part && name === 'Primary');
    return primary >= 0 ? primary : 0;
  });
  const [overrides, setOverrides] = useState<TokenValues>({});
  const [resolved, setResolved] = useState<TokenValues>({});
  const example = examples[exampleIndex];
  const story = `kit-${example.group.toLowerCase()}--${displayName(example.name).toLowerCase().replaceAll(' ', '-')}`;
  const revisionPath = `./revisions/${revision}`;
  const exampleOptions = examples
    .map(({ group, name }, index) => ({
      parity: group !== part,
      value: String(index),
      label: group === part ? displayName(name) : `Parity: ${displayName(name)}`,
    }))
    .sort((left, right) => Number(left.parity) - Number(right.parity));

  return (
    <article className="doc component-doc">
      <header className="component-heading">
        <p className="eyebrow"><span>Components</span> <span className="divider" aria-hidden="true">/</span> {guide.category}</p>
        <h1 id="component-title" tabIndex={-1}>{part}</h1>
        <p className="summary">{guide.summary}</p>
        <details className="references-disclosure">
          <summary>References</summary>
          <nav className="doc-links" aria-label={`${part} references`}>
            <a className="text-link" href={`${revisionPath}/components/${part.toLowerCase()}.md`}>Component Markdown</a>
            <a className="text-link" href={`${revisionPath}/styling.md`}>Styling guide</a>
            <a className="text-link" href={`${revisionPath}/api.md`}>API report</a>
          </nav>
        </details>
      </header>
      <nav className="component-sections" aria-label={`${part} sections`}>
        {componentSections.map(([id, label]) => (
          <a key={id} href={`#${id}`} aria-current={section === id ? 'location' : undefined} onClick={(event) => navigateSection(event, id)}>{label}</a>
        ))}
      </nav>
      <div className="component-surface">
        <section
          id={section === 'tokens' ? 'tokens' : 'playground'}
          className={`preview-workspace${section === 'tokens' ? ' preview-workspace--tokens' : ''}`}
          aria-labelledby={`${section === 'tokens' ? 'tokens' : 'playground'}-title`}
          hidden={section !== 'playground' && section !== 'tokens'}
        >
          <h2 id="playground-title" tabIndex={-1} className="surface-title" hidden={section !== 'playground'}>Playground</h2>
          <h2 id="tokens-title" tabIndex={-1} className="surface-title" hidden={section !== 'tokens'}>Token inspector</h2>
          <div className="playground panel">
            <div className="preview-toolbar">
              <Field label="Example" layout="stacked">
                <Select value={String(exampleIndex)} options={exampleOptions} onValueChange={(value) => setExampleIndex(Number(value))} />
              </Field>
              <details className="appearance-disclosure">
                <summary>Appearance</summary>
                <div className="appearance-controls">
                  <Field label="Theme" layout="stacked">
                    <Select value={appearance.theme} options={themeOptions} onValueChange={(value) => setAppearance({ ...appearance, theme: value as ThemeId })} />
                  </Field>
                  <Field label="Density" layout="stacked">
                    <Select value={appearance.density} options={densityOptions} onValueChange={(value) => setAppearance({ ...appearance, density: value as Density })} />
                  </Field>
                  <Field label="Text size" layout="stacked">
                    <Select value={appearance.textSize} options={textSizeOptions} onValueChange={(value) => setAppearance({ ...appearance, textSize: value as TextSize })} />
                  </Field>
                </div>
              </details>
            </div>
            <div id="live-preview" className="canvas">
              <span className="canvas-badge" aria-hidden="true"><span /> Live preview</span>
              <Preview part={part} group={example.group} name={example.name} appearance={appearance} overrides={overrides} tokenNames={tokenNames} onReadTokens={setResolved} />
            </div>
            <div className="example-notes" hidden={section !== 'playground'}>
              {example.caption && <p>{example.caption}</p>}
              <a className="text-link" href={`./storybook/?path=/story/${story}`}>Open {displayName(example.name)} in Storybook <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div className="token-workspace" hidden={section !== 'tokens'}>
            <p className="section-intro">Try scoped overrides and see the effect in the live preview. Not every token affects the selected example.</p>
            {tokenNames.length > 0
              ? <Inspector part={part} revision={revision} tokenUses={tokenUsage} tokenNames={tokenNames} resolved={resolved} overrides={overrides} setOverrides={setOverrides} />
              : <p className="inline-status">No token uses are recorded for this component.</p>}
          </div>
        </section>
        {section === 'source' && (
          <section id="source" aria-labelledby="source-title">
            <h2 id="source-title" tabIndex={-1} className="surface-title">Example source</h2>
            <p className="section-intro">{exampleOptions.find(({ value }) => value === String(exampleIndex))?.label}</p>
            <ExampleSource key={example.source} path={example.source} />
          </section>
        )}
        {section === 'props' && (
          <section id="props" aria-labelledby="props-title">
            <h2 id="props-title" tabIndex={-1} className="surface-title">Props reference</h2>
            {propGroups.length > 0 ? (
              <>
                <p className="section-intro props-scroll-note">Swipe or scroll across wide tables to see all columns.</p>
                <PropsReference groups={propGroups} />
              </>
            ) : <p className="inline-status">No props are documented for this component.</p>}
          </section>
        )}
        {section === 'usage' && (
          <section id="usage" aria-labelledby="usage-title">
            <h2 id="usage-title" tabIndex={-1} className="surface-title">Usage guidance</h2>
            <ul className="guidance">
              {guide.guidance.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

function App() {
  const result = useJSON<Catalog>('./catalog.json');
  const catalog = result && 'data' in result ? result.data : undefined;
  const [requested, setRequested] = useState(readComponent);
  const [appearance, setAppearance] = useState(defaultAppearance);
  const moveFocus = useRef(false);
  const rail = useRef<HTMLElement>(null);
  const parts = catalog ? Object.keys(catalog.parts) : [];
  const part = requested && parts.includes(requested) ? requested : parts[0];
  const selectedPart = part ? catalog?.parts[part] : undefined;

  useEffect(() => {
    function syncLocation() {
      setRequested(readComponent());
    }
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    document.title = part ? `${part} · Omniview Kit` : 'Omniview Kit';
  }, [part]);

  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      focusComponent();
    }
  }, [requested]);

  function focusComponent() {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('component-title')?.focus({ preventScroll: true });
  }

  function navigate(name: string) {
    if (part === name) {
      focusComponent();
      return;
    }
    history.pushState(null, '', componentHref(name));
    moveFocus.current = true;
    setRequested(name);
  }

  return (
    <>
      <a className="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        const target = document.getElementById('component-title') ?? document.getElementById('main');
        target?.focus();
      }}>Skip to content</a>
      <header className="site-header">
        <div className="shell header-inner">
          <a className="brand" href="./" aria-label="Omniview Kit home">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
              <path d="M4 7.5h20v13H4zM13.9 7.5v13M4 13.8h9.9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span>Omniview <strong>Kit</strong></span>
          </a>
          <nav className="resource-links" aria-label="Resources">
            <a href="./storybook/">Storybook <span aria-hidden="true">↗</span></a>
            <a href="./llms.txt">llms.txt <span aria-hidden="true">↗</span></a>
          </nav>
          <LibraryFinder rail={rail} parts={parts} part={part} onSelect={navigate} />
        </div>
      </header>
      <main id="main" className="shell main-shell" tabIndex={-1}>
        <ComponentRail railRef={rail} parts={parts} part={part} onSelect={navigate} />
        {!result ? <p className="load-status" role="status">Loading the component catalog…</p>
          : catalog && part && selectedPart ? <ComponentDoc key={part} part={part} revision={catalog.revision} catalogPart={selectedPart} appearance={appearance} setAppearance={setAppearance} />
          : <p className="load-status" role="alert">Component catalog unavailable.</p>}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
