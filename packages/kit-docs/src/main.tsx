import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES, THEMES,
  type Density, type TextSize, type ThemeId, type TokenName,
} from '@omniviewdev/kit';
import { guidance, type Guide } from '../content/catalog';
import { Preview, type Appearance, type TokenValues } from './Preview';
import './docs.css';

type Example = { group: string; name: string; source: string };
type Catalog = { revision: string; parts: Record<string, { examples: Example[] }> };
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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  return (
    <div className="copy-control">
      <button type="button" className="action" onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus('Copied');
        } catch {
          setStatus('Clipboard unavailable. Select and copy the code.');
        }
      }}>{label}</button>
      <span aria-live="polite" className="copy-status">{status}</span>
    </div>
  );
}

function Inspector({ part, tokens, resolved, overrides, setOverrides }: {
  part: string;
  tokens: Guide['tokens'];
  resolved: TokenValues;
  overrides: TokenValues;
  setOverrides: (values: TokenValues) => void;
}) {
  const [tokenName, setTokenName] = useState<TokenName>(tokens[0].name);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const token = tokens.find(({ name }) => name === tokenName)!;
  const active = overrides[tokenName];
  const value = resolved[tokenName];
  const edits = tokens.flatMap(({ name }) => overrides[name] === undefined ? [] : [`  ${name}: ${overrides[name]};`]);
  const css = `[data-kit-preview] {\n${edits.join('\n')}\n}\n`;

  function apply(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || /[;{}]/.test(next) || !CSS.supports(token.property, next)) {
      setError(`Enter a valid CSS ${token.property} value.`);
      return;
    }
    setOverrides({ ...overrides, [tokenName]: next });
    setError('');
  }

  return (
    <section id="tokens" className="section" aria-labelledby="tokens-title">
      <p className="eyebrow"><span>02</span> Styling</p>
      <h2 id="tokens-title">Token inspector</h2>
      <p className="section-intro">Read live token values and try overrides. Changes stay inside the preview; they never update the documentation theme.</p>
      <a className="text-link" href="#live-preview">Back to live preview ↑</a>
      <div className="inspector panel">
        <form className="token-form" onSubmit={apply}>
          <label className="field">{part} token
            <select value={tokenName} onChange={(event) => {
              const name = event.target.value as TokenName;
              setTokenName(name);
              setDraft(overrides[name] ?? '');
              setError('');
            }}>
              {tokens.map(({ name }) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <p className="token-role">{token.label}</p>
          <div className="token-reading">
            <span>{active === undefined ? 'Current value' : 'Overridden value'}</span>
            <output className="token-value" aria-live="polite">
              {token.property === 'color' && value && <span className="swatch" style={{ backgroundColor: value }} aria-hidden="true" />}
              <code>{value || '—'}</code>
            </output>
          </div>
          <label className="field">Override value
            <input value={draft} placeholder={token.property === 'color' ? '#74e1b0' : '8px'} aria-invalid={!!error} aria-describedby={error ? 'token-error' : undefined} onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }} />
          </label>
          {error && <p id="token-error" role="alert" className="form-error">{error}</p>}
          <div className="actions">
            <button type="submit" className="action accent-action">Apply override</button>
            <button type="button" className="action" disabled={active === undefined} onClick={() => {
              const next = { ...overrides };
              delete next[tokenName];
              setOverrides(next);
              setDraft('');
              setError('');
            }}>Remove override</button>
          </div>
        </form>
        <div className="overrides">
          <div className="overrides-heading">
            <h3>Preview overrides <span className="count">{edits.length}</span></h3>
            <button className="action" type="button" disabled={!edits.length} onClick={() => {
              setOverrides({});
              setDraft('');
              setError('');
            }}>Reset overrides</button>
          </div>
          {edits.length > 0 ? (
            <>
              <p>Copy these declarations to a scoped stylesheet. Replace the selector with your own preview scope.</p>
              <pre className="export-code" tabIndex={0}><code>{css}</code></pre>
              <div className="actions">
                <CopyButton key={css} text={css} label="Copy CSS overrides" />
                <a className="action download" href={`data:text/css;charset=utf-8,${encodeURIComponent(css)}`} download={`${part.toLowerCase()}-preview.css`}>Download CSS</a>
              </div>
            </>
          ) : <p className="empty-state">No overrides. Add a CSS value to see a scoped export here.</p>}
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
            <label className="field source-file">Source file
              <select value={fileIndex} onChange={(event) => setFileIndex(Number(event.target.value))}>
                {result.data.files.map(({ name }, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            </label>
            <pre tabIndex={0} aria-label={file.name}><code>{file.code}</code></pre>
          </>
        ) : <p className="inline-status" role="alert">Example source unavailable.</p>}
    </section>
  );
}

function ComponentDoc({ part, revision, examples, appearance, setAppearance }: {
  part: string;
  revision: string;
  examples: Example[];
  appearance: Appearance;
  setAppearance: (value: Appearance) => void;
}) {
  const guide = guidance[part];
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
  const regularOptions: { index: number; name: string }[] = [];
  const parityOptions: { index: number; name: string }[] = [];
  examples.forEach(({ group, name }, index) => {
    (group === part ? regularOptions : parityOptions).push({ index, name });
  });

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
        <p className="section-intro">Try the same {part} examples that ship with Kit. Use the controls to explore their states and appearance.</p>
        <a className="text-link" href={`./storybook/?path=/story/${story}`}>Open {displayName(example.name)} in Storybook <span aria-hidden="true">↗</span></a>
        <div className="playground panel">
          <div className="toolbar">
            <label className="field">Example
              <select value={exampleIndex} onChange={(event) => setExampleIndex(Number(event.target.value))}>
                <optgroup label="Component examples">
                  {regularOptions.map(({ index, name }) => <option key={index} value={index}>{displayName(name)}</option>)}
                </optgroup>
                {parityOptions.length > 0 && <optgroup label="Parity examples">
                  {parityOptions.map(({ index, name }) => <option key={index} value={index}>{displayName(name)}</option>)}
                </optgroup>}
              </select>
            </label>
            <label className="field">Theme
              <select value={appearance.theme} onChange={(event) => setAppearance({ ...appearance, theme: event.target.value as ThemeId })}>
                {THEMES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="field">Density
              <select value={appearance.density} onChange={(event) => setAppearance({ ...appearance, density: event.target.value as Density })}>
                {DENSITIES.map((density) => <option key={density} value={density}>{density[0].toUpperCase() + density.slice(1)}</option>)}
              </select>
            </label>
            <label className="field">Text size
              <select value={appearance.textSize} onChange={(event) => setAppearance({ ...appearance, textSize: event.target.value as TextSize })}>
                {TEXT_SIZES.map((size) => <option key={size} value={size}>{size}%</option>)}
              </select>
            </label>
          </div>
          <div id="live-preview" className="canvas">
            <span className="canvas-badge" aria-hidden="true"><span /> Live preview</span>
            <Preview part={part} group={example.group} name={example.name} appearance={appearance} overrides={overrides} onReadTokens={setResolved} />
          </div>
          <ExampleSource key={example.source} path={example.source} />
        </div>
      </section>
      {guide.tokens.length > 0 && <Inspector part={part} tokens={guide.tokens} resolved={resolved} overrides={overrides} setOverrides={setOverrides} />}
      <section id="usage" className="section" aria-labelledby="usage-title">
        <p className="eyebrow"><span>{guide.tokens.length ? '03' : '02'}</span> Patterns</p>
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
  const normalized = query.toLowerCase().replace(/\s+/g, '');
  const matches = parts.filter((name) => name.toLowerCase().includes(normalized));

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
          <nav aria-label="Components">
            <label className="field">Search components
              <input type="search" value={query} placeholder="Find a component" onChange={(event) => setQuery(event.target.value)} />
            </label>
            {catalog && (matches.length ? (
              <ul className="component-links">
                {matches.map((name) => <li key={name}>
                  <a href={componentHref(name)} aria-current={part === name ? 'page' : undefined} onClick={(event) => navigate(event, name)}>{name}</a>
                </li>)}
              </ul>
            ) : <p className="inline-status" role="status">No matching components.</p>)}
          </nav>
          {part && <nav className="on-page" aria-label="On this page">
            <p className="eyebrow">On this page</p>
            <a href="#playground">Playground</a>
            {guidance[part].tokens.length > 0 && <a href="#tokens">Token inspector</a>}
            <a href="#usage">Usage guidance</a>
          </nav>}
        </aside>
        {!result ? <p className="load-status" role="status">Loading the component catalog…</p>
          : catalog && part ? <ComponentDoc key={part} part={part} revision={catalog.revision} examples={catalog.parts[part].examples} appearance={appearance} setAppearance={setAppearance} />
          : <p className="load-status" role="alert">Component catalog unavailable.</p>}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
