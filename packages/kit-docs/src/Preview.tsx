import { useLayoutEffect, useRef, useState } from 'react';
import type { Density, TextSize, ThemeId, TokenName } from '@omniviewdev/kit';

export type TokenValues = Partial<Record<TokenName, string>>;
export type Appearance = { theme: ThemeId; density: Density; textSize: TextSize };

type Selection = { part: string; group: string; name: string };
type Props = Selection & {
  appearance: Appearance;
  overrides: TokenValues;
  onReadTokens: (values: TokenValues) => void;
};

export type PreviewUpdate = Omit<Props, 'onReadTokens'> & {
  type: 'kit-preview:update';
  revision: number;
};

export type PreviewReading = {
  type: 'kit-preview:reading';
  revision: number;
  values: TokenValues;
};

export function Preview({ part, group, name, appearance, overrides, onReadTokens }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const revision = useRef(0);
  const [loadCount, setLoadCount] = useState(0);
  const { theme, density, textSize } = appearance;

  useLayoutEffect(() => {
    function read(event: MessageEvent<PreviewReading>) {
      if (
        event.origin === window.location.origin &&
        event.source === frame.current?.contentWindow &&
        event.data?.type === 'kit-preview:reading' &&
        event.data.revision === revision.current
      ) onReadTokens(event.data.values);
    }
    window.addEventListener('message', read);
    return () => window.removeEventListener('message', read);
  }, [onReadTokens]);

  useLayoutEffect(() => {
    if (loadCount === 0) return;
    const update: PreviewUpdate = {
      type: 'kit-preview:update',
      revision: ++revision.current,
      part,
      group,
      name,
      appearance: { theme, density, textSize },
      overrides,
    };
    frame.current?.contentWindow?.postMessage(update, window.location.origin);
  }, [loadCount, part, group, name, theme, density, textSize, overrides]);

  return (
    <iframe
      ref={frame}
      className="preview-frame"
      title={`${part}: ${name} live preview`}
      src={`${import.meta.env.BASE_URL}frame.html`}
      onLoad={() => setLoadCount((count) => count + 1)}
    />
  );
}
