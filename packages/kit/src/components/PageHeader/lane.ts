/**
 * How the command lane sits with the title (design 12 PH2, shell-page-kit.css): a lane of three controls or fewer stays on the title row
 * until the page is 520 px wide (`short`); a longer lane drops under the identity line below 800 px of page width (`default`), unless
 * lane and title fit one row of the narrowest window the product is used in, a 1030 px window and its 707 px page (`beside`): then it
 * stays until 700 px.
 */
export type LaneMode = 'short' | 'beside' | 'default';

type LaneInput = {
  /** The labels of the labelled commands: the primary, the secondaries that are drawn, the danger one. */
  readonly labels: readonly string[];
  /** How many icon-only controls follow them: the utility and the overflow trigger. */
  readonly icons: number;
  /** The characters of the title, its secondary run and the space before it included. */
  readonly titleLength: number;
  readonly hasTile: boolean;
};

/** The widest row, in px, that lane, title and tile share when the lane stays beside the title (the mock measured it on a 1030 px window). */
const BESIDE_LIMIT = 700;

/**
 * The mock's own measure, kept as it is (shell-page-kit.js): a labelled command is 43 px and 7.5 px a character, an icon command 28 px,
 * the controls 8 px apart, the title 10 px a character after a 32 px tile and its gap, and 12 px of air.
 */
export function laneMode({ labels, icons, titleLength, hasTile }: LaneInput): LaneMode {
  const controls = labels.length + icons;
  if (controls <= 3) {
    return 'short';
  }

  const lane = labels.reduce((sum, label) => sum + 43 + 7.5 * label.length, 0) + 28 * icons + 8 * Math.max(0, controls - 1);
  return lane + 10 * titleLength + (hasTile ? 32 : 0) + 12 <= BESIDE_LIMIT ? 'beside' : 'default';
}
