export const buttonContent = {
  summary: 'Button triggers an action. Use Link for navigation and IconButton for an action presented without visible text.',
  guidance: [
    'Use a short label that says what the action does.',
    'Reserve primary emphasis for the main action in a group.',
    'Use disabledReason when an unavailable action should explain why.',
  ],
} as const;

export const primaryButtonExample = 'Primary';

/** Extract a zero-prop JSX example from Kit's Button example module for the copy button and agent docs. */
export function buttonExampleCode(rawSource: string, exampleName: string): string {
  const lines = rawSource.split(/\r?\n/);
  const declaration = `export const ${exampleName} = () => `;
  const start = lines.findIndex((line) => line.startsWith(declaration));
  const first = lines[start];
  if (first === undefined) throw new Error(`Missing Button example: ${exampleName}`);

  const end = first.endsWith(';') ? start : lines.indexOf(');', start + 1);
  const nextExport = lines.findIndex((line, index) => index > start && line.startsWith('export '));
  if (end < 0 || (nextExport >= 0 && end >= nextExport)) {
    throw new Error(`Unsupported Button example declaration: ${exampleName}`);
  }

  const code = lines.slice(start, end + 1).join('\n');
  const components = ['Button', 'Stack', 'Text'].filter((name) => new RegExp(`<${name}\\b`).test(code));
  return `import { ${components.join(', ')} } from '@omniviewdev/kit';\n\n${code}\n`;
}
