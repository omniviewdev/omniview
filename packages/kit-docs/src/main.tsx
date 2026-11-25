import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button, Field, SearchField, Select, TextInput, ThemeProvider,
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
import './docs.css';

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

const componentHref = (part: string) => `?component=${encodeURIComponent(part)}`;
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
    <section id="tokens" className="section" aria-labelledby="tokens-title">
      <p className="eyebrow"><span>02</span> Styling</p>
      <h2 id="tokens-title">Token inspector</h2>
      <p className="section-intro">Explore tokens found in Kit source and try overrides. Readings come from the preview root. A use in source does not mean the current example renders it.</p>
      <a className="text-link" href="#live-preview">Back to live preview ↑</a>
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
    </section>
  );
}

function ExampleSource({ path }: { path: string }) {
  const result = useJSON<{ files: SourceFile[] }>(`./${path}`);
  const [fileIndex, setFileIndex] = useState(0);
  const file = result && 'data' in result ? result.data.files[fileIndex] : undefined;
  return (
    <section className="source" aria-label="Example source">
      <div className="source-heading">
        <p className="eyebrow">Example source</p>
        {file && <CopyButton key={file.name} text={file.code} label={`Copy ${file.name}`} />}
      </div>
      {!result ? <p className="inline-status" role="status">Loading example source…</p>
        : file && 'data' in result ? (
          <>
            <div className="source-file">
              <Field label="Source file" layout="stacked">
                <Select
                  value={String(fileIndex)}
                  options={result.data.files.map(({ name }, index) => ({ value: String(index), label: name }))}
                  onValueChange={(value) => setFileIndex(Number(value))}
                />
              </Field>
            </div>
            <HighlightedCode code={file.code} fileName={file.name} />
          </>
        ) : <p className="inline-status" role="alert">Example source unavailable.</p>}
    </section>
  );
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
    <article className="doc">
      <div className="hero">
        <p className="eyebrow"><span>Components</span> <span className="divider" aria-hidden="true">/</span> {guide.category}</p>
        <h1 id="component-title" tabIndex={-1}>{part}</h1>
        <p className="summary">{guide.summary}</p>
        <code className="package-tag">@omniviewdev/kit</code>
        <nav className="doc-links" aria-label={`${part} references`}>
          <a className="text-link" href={`${revisionPath}/components/${part.toLowerCase()}.md`}>Component Markdown</a>
          <a className="text-link" href={`${revisionPath}/styling.md`}>Styling guide</a>
          <a className="text-link" href={`${revisionPath}/api.md`}>API report</a>
        </nav>
      </div>
      <section id="playground" className="section" aria-labelledby="playground-title">
        <p className="eyebrow"><span>01</span> Examples</p>
        <h2 id="playground-title">Playground</h2>
        {example.caption && <p className="section-intro">{example.caption}</p>}
        <a className="text-link" href={`./storybook/?path=/story/${story}`}>Open {displayName(example.name)} in Storybook <span aria-hidden="true">↗</span></a>
        <div className="playground panel">
          <div className="toolbar">
            <Field label="Example" layout="stacked">
              <Select value={String(exampleIndex)} options={exampleOptions} onValueChange={(value) => setExampleIndex(Number(value))} />
            </Field>
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
          <div id="live-preview" className="canvas">
            <span className="canvas-badge" aria-hidden="true"><span /> Live preview</span>
            <Preview part={part} group={example.group} name={example.name} appearance={appearance} overrides={overrides} tokenNames={tokenNames} onReadTokens={setResolved} />
          </div>
          <ExampleSource key={example.source} path={example.source} />
        </div>
      </section>
      {tokenNames.length > 0 && <Inspector part={part} revision={revision} tokenUses={tokenUsage} tokenNames={tokenNames} resolved={resolved} overrides={overrides} setOverrides={setOverrides} />}
      {propGroups.length > 0 && (
        <section id="props" className="section" aria-labelledby="props-title">
          <p className="eyebrow"><span>{tokenNames.length > 0 ? '03' : '02'}</span> API</p>
          <h2 id="props-title">Props reference</h2>
          <p className="section-intro props-scroll-note">Swipe or scroll across wide tables to see all columns.</p>
          <PropsReference groups={propGroups} />
        </section>
      )}
      <section id="usage" className="section" aria-labelledby="usage-title">
        <p className="eyebrow"><span>{String(2 + Number(propGroups.length > 0) + Number(tokenNames.length > 0)).padStart(2, '0')}</span> Patterns</p>
        <h2 id="usage-title">Usage guidance</h2>
        <ul className="guidance">
          {guide.guidance.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </section>
      <footer className="doc-footer">
        <span>Omniview Kit · Component documentation</span>
        <a href="#main">Back to top ↑</a>
      </footer>
    </article>
  );
}

function App() {
  const result = useJSON<Catalog>('./catalog.json');
  const catalog = result && 'data' in result ? result.data : undefined;
  const [requested, setRequested] = useState(readComponent);
  const [query, setQuery] = useState('');
  const [appearance, setAppearance] = useState(defaultAppearance);
  const moveFocus = useRef(false);
  const parts = catalog ? Object.keys(catalog.parts) : [];
  const part = requested && parts.includes(requested) ? requested : parts[0];
  const selectedPart = part ? catalog?.parts[part] : undefined;
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const groups = new Map<string, string[]>();
  let matchCount = 0;
  for (const name of parts) {
    const category = guidance[name].category;
    let matches = groups.get(category);
    if (!matches) groups.set(category, matches = []);
    if (terms.length > 0) {
      const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const categoryKey = category.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!terms.every((term) => nameKey.includes(term) || categoryKey.includes(term))) continue;
    }
    matches.push(name);
    matchCount++;
  }
  const visibleGroups = Array.from(groups).filter(([, matches]) => matches.length > 0);

  useEffect(() => {
    function syncLocation() {
      setRequested(readComponent());
    }
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    document.title = part ? `${part} · Omniview Kit` : 'Omniview Kit';
    if (moveFocus.current) {
      moveFocus.current = false;
      document.getElementById('component-title')?.focus();
    }
  }, [part, requested]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, name: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (requested === name) {
      document.getElementById('component-title')?.focus();
      return;
    }
    history.pushState(null, '', componentHref(name));
    moveFocus.current = true;
    setRequested(name);
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
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
        </div>
      </header>
      <main id="main" className="shell main-shell" tabIndex={-1}>
        <aside className="sidebar" aria-label="Documentation navigation">
          <nav className="component-finder" aria-label="Components">
            <div className="finder-search">
              <span aria-hidden="true">Search components</span>
              <SearchField label="Search components" value={query} placeholder="Name or category" onValueChange={setQuery} />
            </div>
            {catalog && <p className="inline-status" role="status">
              {matchCount === 0 ? 'No matching components.' : terms.length > 0 ? `${matchCount} found` : ''}
            </p>}
            {visibleGroups.length > 0 && <div className="finder-results">
              {visibleGroups.map(([category, matches], index) => (
                <div className="finder-group" key={category}>
                  <h2 className="eyebrow" id={`finder-category-${index}`}>{category}</h2>
                  <ul className="component-links" aria-labelledby={`finder-category-${index}`} role="list">
                    {matches.map((name) => <li key={name}>
                      <a href={componentHref(name)} aria-current={part === name ? 'page' : undefined} onClick={(event) => navigate(event, name)}>{name}</a>
                    </li>)}
                  </ul>
                </div>
              ))}
            </div>}
          </nav>
          {selectedPart && <nav className="on-page" aria-label="On this page">
            <p className="eyebrow">On this page</p>
            <a href="#playground">Playground</a>
            {selectedPart.tokenUsage.length > 0 && <a href="#tokens">Token inspector</a>}
            {selectedPart.propGroups.length > 0 && <a href="#props">Props reference</a>}
            <a href="#usage">Usage guidance</a>
          </nav>}
        </aside>
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
