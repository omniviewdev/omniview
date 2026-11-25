import type { StatusRole } from '@omniviewdev/kit';
import type { Condition, Severity } from './types';

// The words of the Problems tool's body (ch16 S121; the mock's shell-panel.js 2211-2238): what its table is called, what its footer counts, what a missing target and a row with no page say, and how a row's open button is
// named. One place, so the body and its tests say the same words. The words of the tool's tab and of its empty state are in `./tool.ts`.

/** The table's name: the view's one scroll region, and the plural of what it lists. */
export const PROBLEMS_LABEL = 'Problems';

/** What the footer counts: `1 problem`, `8 problems`. The footer prints the nouns as they are written here. */
export const PROBLEM_NOUNS = { one: 'problem', other: 'problems' } as const;

/** What the dash of an empty Target cell is named by: the dash is drawn, the words are read (`MissingValue`). */
export const NO_TARGET = 'No target';

/** Why a row whose condition has no subject cannot be opened: the button stays where it is and says so, to the keyboard and a screen reader as well as to the pointer. */
export const NO_PAGE = 'This problem has no page of its own';

/** The kit's role of each severity: the glyph of the Condition cell is the role's, and the word beside it is the condition's own. A warning is `attention`: it needs a look, and nothing is broken. */
export const ROLE_OF: Readonly<Record<Severity, StatusRole>> = { error: 'error', warning: 'attention', info: 'info' };

/** The name of a row's open button: the action and its object (`Open north`), the object being what the row is about, else the plugin it is from. */
export const openLabel = (condition: Condition): string => `Open ${condition.target ?? condition.source.name}`;
