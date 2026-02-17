export function plural(word: string, amount?: number): string {
  if (amount !== undefined && amount === 1) return word;
  const pluralRules: Record<string, string> = {
    '(quiz)$': '$1zes',
    '^(ox)$': '$1en',
    '([m|l])ouse$': '$1ice',
    '(matr|vert|ind)ix|ex$': '$1ices',
    '(x|ch|ss|sh)$': '$1es',
    '([^aeiouy]|qu)y$': '$1ies',
    '(hive)$': '$1s',
    '(?:([^f])fe|([lr])f)$': '$1$2ves',
    '(shea|lea|loa|thie)f$': '$1ves',
    'sis$': 'ses',
    '([ti])um$': '$1a',
    '(tomat|potat|ech|her|vet)o$': '$1oes',
    '(bu)s$': '$1ses',
    '(alias)$': '$1es',
    '(octop)us$': '$1i',
    '(ax|test)is$': '$1es',
    '(us)$': '$1es',
    '([^s]+)$': '$1s',
  };
  const irregular: Record<string, string> = {
    'move': 'moves', 'foot': 'feet', 'goose': 'geese', 'sex': 'sexes',
    'child': 'children', 'man': 'men', 'tooth': 'teeth', 'person': 'people',
  };
  const uncountable: string[] = [
    'sheep', 'fish', 'deer', 'moose', 'series', 'species', 'money', 'rice',
    'information', 'equipment', 'bison', 'cod', 'offspring', 'pike', 'salmon',
    'shrimp', 'swine', 'trout', 'aircraft', 'hovercraft', 'spacecraft', 'sugar',
    'tuna', 'you', 'wood',
  ];
  if (uncountable.includes(word.toLowerCase())) return word;
  for (const w in irregular) {
    const pattern = new RegExp(`${w}$`, 'i');
    if (pattern.test(word)) return word.replace(pattern, irregular[w]);
  }
  for (const reg in pluralRules) {
    const pattern = new RegExp(reg, 'i');
    if (pattern.test(word)) return word.replace(pattern, pluralRules[reg]);
  }
  return word;
}
