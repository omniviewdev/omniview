import { useEffect, useState, type ReactNode } from 'react';
import type * as Prism from 'prismjs';
import './highlight.css';

type Language = 'typescript' | 'tsx' | 'javascript' | 'css';

function sourceLanguage(fileName: string): Language | undefined {
  switch (/\.(\w+)$/.exec(fileName)?.[1].toLowerCase()) {
    case 'ts': case 'cts': case 'mts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'js': case 'cjs': case 'mjs': return 'javascript';
    case 'css': return 'css';
  }
}

async function loadPrism() {
  // Keep Prism out of the startup bundle and register grammars only after its core loads.
  const { default: prism } = await import('prismjs');
  prism.manual = true;
  // Prism bundles CSS and JavaScript; TSX builds on both JSX and TypeScript.
  await Promise.all([
    import('prismjs/components/prism-jsx.js'),
    import('prismjs/components/prism-typescript.js'),
  ]);
  await import('prismjs/components/prism-tsx.js');
  return prism;
}

let prismPromise: Promise<typeof Prism> | undefined;

function renderToken(token: Prism.TokenStream, key?: number): ReactNode {
  if (typeof token === 'string') return token;
  if (Array.isArray(token)) return token.map(renderToken);
  const alias = Array.isArray(token.alias) ? token.alias.join(' ') : token.alias;
  return (
    <span key={key} className={alias ? `token ${token.type} ${alias}` : `token ${token.type}`}>
      {renderToken(token.content)}
    </span>
  );
}

export function HighlightedCode({ code, fileName, label = fileName, className }: {
  code: string;
  fileName: string;
  label?: string;
  className?: string;
}) {
  const language = sourceLanguage(fileName);
  const [highlight, setHighlight] = useState<{ code: string; language: Language; content: ReactNode }>();

  useEffect(() => {
    if (!language || !code) return;
    let cancelled = false;
    (prismPromise ??= loadPrism()).then((prism) => {
      if (cancelled) return;
      // Run the same hooks as Prism.highlight, but render tokens as React text rather than HTML.
      // The JSX hook distinguishes text inside nested tags from JavaScript expressions.
      const env: Prism.hooks.TokenizeEnvironment & { tokens: Prism.TokenStream } = {
        code, language, grammar: prism.languages[language], tokens: [],
      };
      prism.hooks.run('before-tokenize', env);
      env.tokens = prism.tokenize(env.code, env.grammar);
      prism.hooks.run('after-tokenize', env);
      setHighlight({ code, language, content: renderToken(env.tokens) });
    }).catch(() => {
      // The source remains readable if loading or tokenization fails.
    });
    return () => { cancelled = true; };
  }, [code, language]);

  const content = highlight?.code === code && highlight.language === language ? highlight.content : code;
  return (
    <pre className={className ? `highlighted-code ${className}` : 'highlighted-code'} tabIndex={0} role="region" aria-label={label}>
      <code>{content}</code>
    </pre>
  );
}
