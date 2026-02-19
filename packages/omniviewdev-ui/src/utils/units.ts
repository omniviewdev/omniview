export type ByteUnit =
  | 'E'
  | 'EB'
  | 'P'
  | 'PB'
  | 'T'
  | 'TB'
  | 'G'
  | 'GB'
  | 'M'
  | 'MB'
  | 'k'
  | 'KB'
  | 'Ei'
  | 'Pi'
  | 'Ti'
  | 'Gi'
  | 'Mi'
  | 'Ki'
  | 'B';

export type ByteConversionOptions = {
  from: string;
  to?: ByteUnit;
  round?: boolean | number;
};

const unitMultipliers: { [unit in ByteUnit]: bigint } = {
  E: 10n ** 18n,
  EB: 10n ** 18n,
  P: 10n ** 15n,
  PB: 10n ** 15n,
  T: 10n ** 12n,
  TB: 10n ** 12n,
  G: 10n ** 9n,
  GB: 10n ** 9n,
  M: 10n ** 6n,
  MB: 10n ** 6n,
  k: 10n ** 3n,
  KB: 10n ** 3n,
  Ei: 2n ** 60n,
  Pi: 2n ** 50n,
  Ti: 2n ** 40n,
  Gi: 2n ** 30n,
  Mi: 2n ** 20n,
  Ki: 2n ** 10n,
  B: 1n,
};

export function convertByteUnits({
  from,
  to = 'MB',
  round: _round,
}: ByteConversionOptions): string {
  const regex = /^(\d+(?:\.\d+)?)([EPTGMkEiPiTiGiMiKiB]*)$/;
  const match = regex.exec(from);

  if (!match) {
    return '';
  }

  const [, valueStr, unit] = match;

  let [integerPart, fractionalPart = ''] = valueStr.split('.');
  fractionalPart = fractionalPart.padEnd(6, '0');

  const value = BigInt(integerPart) * 10n ** 6n + BigInt(fractionalPart);
  const fromMultiplier = unitMultipliers[unit as ByteUnit] || 1n;
  const toMultiplier = unitMultipliers[to];

  const resultInBytes = (value * fromMultiplier) / 10n ** 6n;
  const result = resultInBytes / toMultiplier;

  return `${result}${to}`;
}
