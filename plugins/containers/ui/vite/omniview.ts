import type { Plugin } from 'vite';

/**
 * The host app only loads `assets/entry.js`, so CSS emitted by the build (CSS
 * modules) would never reach the page. Fold it into the entry chunk as a
 * <style> tag that is added when the plugin bundle is evaluated.
 */
export function injectCssIntoEntry(pluginId: string): Plugin {
  return {
    name: 'omniview-inject-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const cssFiles = Object.values(bundle).filter(
        (file) => file.type === 'asset' && file.fileName.endsWith('.css'),
      );
      if (cssFiles.length === 0) return;

      const css = cssFiles
        .map((file) => (file.type === 'asset' ? String(file.source) : ''))
        .join('\n');
      for (const file of cssFiles) delete bundle[file.fileName];

      const entry = Object.values(bundle).find(
        (file) => file.type === 'chunk' && file.isEntry,
      );
      if (!entry || entry.type !== 'chunk') return;

      const attr = `data-omniview-plugin-css`;
      entry.code +=
        `\n;(function(){var id=${JSON.stringify(pluginId)};` +
        `var old=document.querySelector('style[${attr}="'+id+'"]');if(old)old.remove();` +
        `var s=document.createElement('style');s.setAttribute('${attr}',id);` +
        `s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n`;
    },
  };
}
