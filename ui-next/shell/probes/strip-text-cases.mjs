// The cases of the tab strip's text comparison with the mock (step S3, demo findings D4 and D8): the one list the mock's measurer (mock-strip-text-measure.mjs) and the strip probe (strip-probe.mjs, sections `titles` and
// `twins`) both read, so the mock and the shell draw the same tabs. A page is `{ title, scope? }`: the shell's `staticTabs` (shell/testing.tsx) and the mock's `H.tabStrip` take both. The first tab of a case is on screen.
//
// D4: a title is cut where the mock cuts it (S17: "Inside that width the scope elides first, then the title in the middle"; S17a: the faces are equal, 96 to 208 px, "Small counts stop growing at 208px; remaining space belongs
// to the native drag lane"), so a title that does not fit 148 px is cut however empty the strip is. D8: a tab says its scope only when another tab of the strip would read the same ("The face carries NO scope by default": the muted
// 12 px text after the title is a disambiguator).
const filler = (count) => Array.from({ length: count }, (_, index) => ({ title: `Page ${String(index + 2)}` }));

export const TEXT_CASES = [
  // One tab, 208 px, the title as long as the case says: a title of twelve graphemes or fewer is one part; longer is a head and a tail (a separator, else the midpoint).
  { id: 'short', pages: [{ title: 'Entries' }] },
  { id: 'twelve', pages: [{ title: 'Twelve chars' }] },
  { id: 'thirteen', pages: [{ title: 'Thirteen char' }] },
  { id: 'named-kind', pages: [{ title: 'payment-gateway · Deployment' }] },
  { id: 'path', pages: [{ title: 'storage/backups/2026-11-20/archive.tar' }] },
  { id: 'colon', pages: [{ title: 'queue:payments:retry-worker' }] },
  { id: 'unbroken', pages: [{ title: 'abcdefghijklmnopqrstuvwxyzabcdefghij' }] },
  // The same title when the strip is full: the faces share the strip and give way together, to 96 px at the least.
  { id: 'five', pages: [{ title: 'payment-gateway · Deployment' }, ...filler(4)] },
  { id: 'crowded', pages: [{ title: 'payment-gateway · Deployment' }, ...filler(11)] },
  // D8: scope. A lone tab says none; two tabs that read alike say the shortest text that tells them apart; a tab that reads like no other says none, whatever the others do.
  { id: 'lone-scoped', pages: [{ title: 'Entries', scope: 'north' }] },
  { id: 'twins', pages: [{ title: 'Entries', scope: 'north' }, { title: 'Entries', scope: 'south' }] },
  { id: 'twins-and-other', pages: [{ title: 'Entries', scope: 'north' }, { title: 'Entries', scope: 'south' }, { title: 'Other', scope: 'north' }] },
  { id: 'twins-long', pages: [{ title: 'Entries', scope: 'production-europe-west' }, { title: 'Entries', scope: 'production-america-east' }] },
  { id: 'twins-cut', pages: [{ title: 'payment-gateway · Deployment', scope: 'north' }, { title: 'payment-gateway · Deployment', scope: 'south' }] },
];
