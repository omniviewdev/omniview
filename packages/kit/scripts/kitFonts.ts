/**
 * The font files ship beside the stylesheet, not inside it.
 *
 * Vite builds a library with every asset inlined, whatever its size (`build.assetsInlineLimit` does not apply to `build.lib`): the
 * three fonts would become 141 KB of base64 in `styles.css`, parsed with the stylesheet and never cacheable, preloadable or shared
 * between faces, which the design forbids (research chapter 02, "base64 copy in every stylesheet"). So the plugin takes the font
 * URLs out of Vite's sight while it builds, then writes the files into `dist/fonts/` and points the built stylesheet at them. The host's
 * own Vite resolves `./fonts/<file>` against `node_modules/@omniviewdev/kit/dist/styles.css` and emits each file once, hashed.
 *
 *   src/styles/fonts.css   url('../../fonts/<file>.woff2')    what is written, and resolves in the repository
 *   while Vite builds      url('/__ov-font__/<file>.woff2')   a path no file has, so Vite leaves it alone
 *   dist/styles.css        url('./fonts/<file>.woff2')        what ships, beside dist/fonts/<file>.woff2
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** The stand-in URL prefix; the build keeps it out of the Rolldown externals warning through `build.rolldownOptions.external`. */
export const FONT_URL_PLACEHOLDER = '/__ov-font__/';

const SOURCE_URL = /url\('\.\.\/\.\.\/fonts\/([^'/]+\.woff2)'\)/g;

/** Points each font URL of the stylesheet at the placeholder, and names the files it found. */
export function hideFontUrls(css: string): { readonly css: string; readonly files: readonly string[] } {
  const files = [...css.matchAll(SOURCE_URL)].map((match) => match[1] ?? '');
  return { css: css.replace(SOURCE_URL, (_url, file: string) => `url('${FONT_URL_PLACEHOLDER}${file}')`), files };
}

/** The built stylesheet's font URLs: relative to the stylesheet, into `fonts/` of the package. The printer's quoting is left as it is. */
export function showFontUrls(css: string): string {
  return css.replaceAll(FONT_URL_PLACEHOLDER, './fonts/');
}

/** The Vite plugin: hides the font URLs from the build, then ships the files beside the stylesheet. */
export function kitFonts(packageRoot: string): Plugin {
  const files = new Set<string>();
  return {
    name: 'ov-kit-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?', 1)[0]?.endsWith('/src/styles/fonts.css')) {
        return null;
      }

      const hidden = hideFontUrls(code);
      for (const file of hidden.files) {
        files.add(file);
      }

      return { code: hidden.css, map: null };
    },
    generateBundle: {
      // After Vite has emitted the stylesheet: in a library build that happens in this very hook.
      order: 'post',
      handler(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === 'asset' && output.fileName.endsWith('.css') && typeof output.source === 'string') {
            output.source = showFontUrls(output.source);
          }
        }

        for (const file of files) {
          this.emitFile({ type: 'asset', fileName: path.posix.join('fonts', file), source: readFileSync(path.join(packageRoot, 'fonts', file)) });
        }
      },
    },
  };
}
