export type KubernetesByteUnit =
  | "E"
  | "EB"
  | "P"
  | "PB"
  | "T"
  | "TB"
  | "G"
  | "GB"
  | "M"
  | "MB"
  | "k"
  | "KB"
  | "Ei"
  | "Pi"
  | "Ti"
  | "Gi"
  | "Mi"
  | "Ki"
  | "B";

export interface ByteConversionOptions {
  from: string;
  to: KubernetesByteUnit;
  round?: boolean | number;
}

const unitMultipliers: { [unit in KubernetesByteUnit]: bigint } = {
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

// function divideAndRoundBigInt(
//   numerator: bigint,
//   denominator: bigint,
//   roundTo: boolean | number,
// ): string {
//   if (typeof roundTo === "boolean" && roundTo) {
//     const halfDenominator = denominator / 2n;
//     return ((numerator + halfDenominator) / denominator).toString();
//   } else if (typeof roundTo === "number") {
//     const factor = 10n ** BigInt(roundTo);
//     const adjustedNumerator = numerator * factor;
//     const result = (adjustedNumerator + denominator / 2n) / denominator;
//     return (
//       (result / factor).toString() +
//       "." +
//       (result % factor).toString().padStart(roundTo, "0")
//     );
//   } else {
//     return (numerator / denominator).toString();
//   }
// }

export function convertKubernetesByteUnits({
  from,
  to,
  round,
}: ByteConversionOptions): string {
  const regex = /^(\d+(?:\.\d+)?)([EPTGMkEiPiTiGiMiKiB]*)$/;
  const match = from.match(regex);

  if (!match) return "";

  const [, valueStr, unit] = match;
  // Convert float to bigint accurately by handling the part after the decimal

  /* eslint-disable prefer-const */
  let [integerPart, fractionalPart = ""] = valueStr.split(".");
  fractionalPart = fractionalPart.padEnd(6, "0"); // Ensure the fractional part is 6 digits for precision
  const value = BigInt(integerPart) * 10n ** 6n + BigInt(fractionalPart); // Convert to bigint equivalent with precision

  const fromMultiplier = unitMultipliers[unit as KubernetesByteUnit] || 1n;
  const toMultiplier = unitMultipliers[to];

  const resultInBytes = (value * fromMultiplier) / 10n ** 6n; // Convert input to bytes with precision maintained
  const result = resultInBytes / toMultiplier;

  if (round !== undefined) {
    // TODO
  }

  return `${result}${to}`;
}
