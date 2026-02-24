import MDPreview from '@uiw/react-markdown-preview';

export interface MarkdownPreviewProps {
  source: string;
  maxHeight?: number | string;
}

export default function MarkdownPreview({ source, maxHeight }: MarkdownPreviewProps) {
  return (
    <MDPreview
      source={source}
      style={{
        backgroundColor: 'transparent',
        overflow: 'auto',
        maxHeight: maxHeight ?? 'none',
      }}
      wrapperElement={{ 'data-color-mode': 'dark' }}
    />
  );
}

MarkdownPreview.displayName = 'MarkdownPreview';
