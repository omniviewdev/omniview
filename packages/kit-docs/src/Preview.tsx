import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Density, TextSize, ThemeId, TokenName } from '@omniviewdev/kit';
import kitStyles from '@omniviewdev/kit/styles.css?inline';

export const tokens = [
  { name: '--ov-accent', label: 'Primary fill and focus ring', property: 'color' },
  { name: '--ov-fg-over-accent', label: 'Label on solid fill', property: 'color' },
  { name: '--ov-fg', label: 'Neutral label', property: 'color' },
  { name: '--ov-icon', label: 'Neutral icon', property: 'color' },
  { name: '--ov-border-control', label: 'Secondary border', property: 'color' },
  { name: '--ov-hover-row', label: 'Secondary hover fill', property: 'color' },
  { name: '--ov-hover-toolbar', label: 'Ghost hover / secondary pressed fill', property: 'color' },
  { name: '--ov-pressed', label: 'Ghost pressed fill', property: 'color' },
  { name: '--ov-error-fg', label: 'Danger label', property: 'color' },
  { name: '--ov-error-control', label: 'Primary danger fill', property: 'color' },
  { name: '--ov-fg-disabled', label: 'Unavailable label', property: 'color' },
  { name: '--ov-icon-disabled', label: 'Unavailable icon', property: 'color' },
  { name: '--ov-bg-island', label: 'Unavailable fill', property: 'color' },
  { name: '--ov-border-disabled', label: 'Unavailable border', property: 'color' },
  { name: '--ov-control-height', label: 'Standard and compact minimum height', property: 'min-height' },
  { name: '--ov-row-target', label: 'Row height', property: 'height' },
  { name: '--ov-radius-control', label: 'Corner radius', property: 'border-radius' },
  { name: '--ov-spacing-4', label: 'Vertical padding and icon gap', property: 'padding-top' },
  { name: '--ov-spacing-8', label: 'Compact and row side padding', property: 'padding-inline-start' },
  { name: '--ov-spacing-12', label: 'Standard side padding', property: 'padding-inline-start' },
  { name: '--ov-fs-13', label: 'Label font size', property: 'font-size' },
  { name: '--ov-lh-16', label: 'Label line height', property: 'line-height' },
] as const satisfies readonly { name: TokenName; label: string; property: string }[];

export type PreviewToken = (typeof tokens)[number]['name'];
export type TokenValues = Partial<Record<PreviewToken, string>>;
export type Appearance = { theme: ThemeId; density: Density; textSize: TextSize };

const frameMarkup = '<!doctype html><html lang="en"><head><title>Button preview</title></head><body></body></html>';
const canvasStyles = `
  html { height: 100%; }
  body { height: 100%; margin: 0; display: grid; }
  [data-kit-preview] {
    min-width: 0;
    display: grid;
    place-items: center;
    background-image: radial-gradient(var(--ov-border-control) 0.8px, transparent 0.8px);
    background-size: 17px 17px;
    background-position: center;
  }
`;

type Props = {
  appearance: Appearance;
  overrides: TokenValues;
  onReadTokens: (values: TokenValues) => void;
  children: ReactNode;
};

export function Preview({ appearance, overrides, onReadTokens, children }: Props) {
  const [frame, setFrame] = useState<Document | null>(null);

  useLayoutEffect(() => {
    if (!frame) return;
    const root = frame.documentElement;
    root.setAttribute('data-ov-theme', appearance.theme);
    root.setAttribute('data-ov-density', appearance.density);
    root.setAttribute('data-ov-text-size', appearance.textSize);
    const scope = frame.querySelector('[data-kit-preview]');
    if (!scope || !frame.defaultView) return;
    const styles = frame.defaultView.getComputedStyle(scope);
    const current: TokenValues = {};
    for (const { name } of tokens) current[name] = styles.getPropertyValue(name).trim();
    onReadTokens(current);
  }, [appearance, frame, onReadTokens, overrides]);

  return (
    <>
      <iframe
        className="preview-frame"
        title="Isolated Button preview"
        srcDoc={frameMarkup}
        onLoad={({ currentTarget }) => {
          const doc = currentTarget.contentDocument;
          if (!doc) return;
          const sheet = doc.createElement('style');
          sheet.textContent = `${kitStyles}\n${canvasStyles}`;
          doc.head.append(sheet);
          setFrame(doc);
        }}
      />
      {frame && createPortal(
        <div data-kit-preview="" style={overrides as CSSProperties}>{children}</div>,
        frame.body,
      )}
    </>
  );
}
