import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_DENSITY, DEFAULT_TEXT_SIZE, DEFAULT_THEME_ID, DENSITIES, TEXT_SIZES, THEMES,
  type Density, type TextSize, type ThemeId,
} from '@omniviewdev/kit';
import { examples } from '@omniviewdev/kit/examples';
import { buttonContent, buttonExampleCode, primaryButtonExample } from '../content/button';
import buttonSource from '../../kit/src/components/Button/Button.examples.tsx?raw';
import { Preview, tokens, type Appearance, type PreviewToken, type TokenValues } from './Preview';
import './docs.css';

const buttonExamples = examples.Button;
const exampleNames = Object.keys(buttonExamples);
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

function Inspector({ resolved, overrides, setOverrides }: {
  resolved: TokenValues;
  overrides: TokenValues;
  setOverrides: (values: TokenValues) => void;
}) {
  const [tokenName, setTokenName] = useState<PreviewToken>(tokens[0].name);
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
      <a className="text-link" href="#button-preview">Back to live preview ↑</a>
      <div className="inspector panel">
        <form className="token-form" onSubmit={apply}>
          <label className="field">Button token
            <select value={tokenName} onChange={(event) => {
              const name = event.target.value as PreviewToken;
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
                <a className="action download" href={`data:text/css;charset=utf-8,${encodeURIComponent(css)}`} download="button-preview.css">Download CSS</a>
              </div>
            </>
          ) : <p className="empty-state">No overrides. Add a CSS value to see a scoped export here.</p>}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [example, setExample] = useState<string>(primaryButtonExample);
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [overrides, setOverrides] = useState<TokenValues>({});
  const [resolved, setResolved] = useState<TokenValues>({});
  const Example = buttonExamples[example];
  const tsx = buttonExampleCode(buttonSource, example);
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
            <a href="./storybook/?path=/story/kit-button--primary">Storybook <span aria-hidden="true">↗</span></a>
            <a href="./llms.txt">llms.txt <span aria-hidden="true">↗</span></a>
          </nav>
        </div>
      </header>
      <main id="main" className="shell main-shell" tabIndex={-1}>
        <aside className="sidebar" aria-label="Documentation navigation">
          <p className="eyebrow">Components</p>
          <a className="current" href="#main" aria-current="page"><span aria-hidden="true">◈</span> Button</a>
          <nav className="on-page" aria-label="On this page">
            <p className="eyebrow">On this page</p>
            <a href="#playground">Playground</a>
            <a href="#tokens">Token inspector</a>
            <a href="#usage">Usage guidance</a>
          </nav>
        </aside>
        <article className="doc">
          <div className="hero">
            <p className="eyebrow"><span>Components</span> <span className="divider" aria-hidden="true">/</span> Actions</p>
            <h1>Button</h1>
            <p className="summary">{buttonContent.summary}</p>
            <code className="package-tag">@omniviewdev/kit</code>
          </div>
          <section id="playground" className="section" aria-labelledby="playground-title">
            <p className="eyebrow"><span>01</span> Examples</p>
            <h2 id="playground-title">Playground</h2>
            <p className="section-intro">Try the same Button examples that ship with Kit. Hover, press, or use Tab to explore the live states.</p>
            <div className="playground panel">
              <div className="toolbar">
                <label className="field">Example
                  <select value={example} onChange={(event) => setExample(event.target.value)}>
                    {exampleNames.map((name) => <option key={name} value={name}>{name.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
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
              <div id="button-preview" className="canvas">
                <span className="canvas-badge" aria-hidden="true"><span /> Live preview</span>
                <Preview appearance={appearance} overrides={overrides} onReadTokens={setResolved}><Example /></Preview>
              </div>
              <div className="source">
                <div className="source-heading">
                  <span className="eyebrow">Example source <span className="source-format">TSX</span></span>
                  <CopyButton key={example} text={tsx} label="Copy TSX" />
                </div>
                <pre tabIndex={0}><code>{tsx}</code></pre>
              </div>
            </div>
          </section>
          <Inspector resolved={resolved} overrides={overrides} setOverrides={setOverrides} />
          <section id="usage" className="section" aria-labelledby="usage-title">
            <p className="eyebrow"><span>03</span> Patterns</p>
            <h2 id="usage-title">Usage guidance</h2>
            <ul className="guidance">
              {buttonContent.guidance.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </section>
          <footer className="doc-footer">
            <span>Omniview Kit · Component documentation</span>
            <a href="#main">Back to top ↑</a>
          </footer>
        </article>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
