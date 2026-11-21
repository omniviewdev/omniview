import type { SessionState } from './types';

// What a session tab is called by a person who cannot see it. The model owns these words because it makes the tab names unique by them: two tabs may not be HEARD alike, and what a tab is heard as is its name and its
// state, so a title that reads like another session's name and state (an ended `task` and a running `task, ended`) has to be told apart before the strip draws (CodeRabbit, selectors.ts, #609).

/** What a state is called in a tab's accessible name; a session that runs says nothing (a steady state has no word). */
const STATE_WORDS: Readonly<Record<SessionState, string>> = { starting: 'starting', running: '', ended: 'ended', failed: 'failed' };

export const stateWord = (state: SessionState): string => STATE_WORDS[state];

/** What a tab is heard as: its name and, when its session is not steady, its state (ch16 SCT1: no plain-text tooltip repeats it). `task` that ended is heard as `task, ended`. */
export function heardAs(name: string, state: SessionState): string {
  const word = stateWord(state);
  return word === '' ? name : `${name}, ${word}`;
}

/** What two names are compared by when no two tabs may be alike: runs of white space count as one space (the accessible name is computed so, and the browser draws them so), so `build  job` and `build job` are one name. */
export const sameWords = (name: string): string => name.replace(/\s+/g, ' ').trim();
