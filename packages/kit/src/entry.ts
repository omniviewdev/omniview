// The bundle entry. The stylesheet comes first: the layer order statement must be the first rule of `styles.css`, then the tokens,
// then the document paint; parts import their own CSS Modules after these. A library build extracts all of it into
// `dist/styles.css` (entry "./styles.css"). Declarations come from index.ts, which holds no CSS import, so `dist/index.d.ts` is plain TypeScript.
import './styles/layers.css';
import './generated/tokens.css';
import './styles/base.css';

export * from './index';
