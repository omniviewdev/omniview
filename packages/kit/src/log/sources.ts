// The sources a log view has heard of (L2). A log that follows several sources (a service's instances, an application's processes) shows which one wrote each line, as the mock does (shell-panel.js
// `chipOf`, `badgesOn`): a name that is text, and a hue from a series of seven that makes two sources tell apart at a glance. A source is heard of from a line that names it or from the
// feed's own list of what it follows, whichever comes first; the view shows the column when it has heard of more than one, and never takes it back, so the shape of the log does not change under
// a reader who is scrolled somewhere in it.
import type { LogFeedSource, LogHue } from './types';

/** The hues of the series, in the mock's order (`SRC_COLORS`, shell-panel.js 332). The eighth source takes the first again, as the mock's `i % 7` does: the name is what tells them apart. */
export const SOURCE_HUES: readonly LogHue[] = ['blue', 'green', 'amber', 'purple', 'cyan', 'red', 'gray'];

/** A source as a row draws it. The same object for a source until its label changes: a row compares it by identity, so a flush that appends lines changes no row that was there (HLT-2). */
export type SourceTag = {
  readonly id: string;
  /** What the row says: the label the feed gave, else the id. */
  readonly label: string;
  /** The hue of the source's place in the series: its order of first being heard of, which never changes. */
  readonly hue: LogHue;
};

function makeTag(id: string, label: string, place: number): SourceTag {
  return { id, label, hue: SOURCE_HUES[place % SOURCE_HUES.length] ?? 'gray' };
}

export class LogSources {
  private readonly tags = new Map<string, SourceTag>();
  /** The id the last line named: lines of one source come in runs, so most lines are answered by a comparison and not by a lookup. `''` names none. */
  private lastId = '';
  private listed: readonly LogFeedSource[] | undefined;

  /** How many sources the view has heard of. */
  get count(): number {
    return this.tags.size;
  }

  /** A line named `id`. A line that names none (`''`) is no source. */
  note(id: string): void {
    if (id === this.lastId || id === '') {
      return;
    }

    this.lastId = id;
    if (!this.tags.has(id)) {
      this.tags.set(id, makeTag(id, id, this.tags.size));
    }
  }

  /** The tag of a source the view has heard of. */
  tag(id: string): SourceTag | undefined {
    return this.tags.get(id);
  }

  /**
   * What the feed lists: sources it follows that may not have spoken yet, in the order it lists them, and the names it gives them. A listing is the feed's word as it stands: the name of a source is the label
   * the latest listing gives it, else its id, so a label that goes away is the id again, which is what the host's card says from the same listing (the rows and the card never disagree). A source already
   * heard of keeps its place in the series, and one the feed no longer lists keeps its last name (its lines are still in the log). The same list read again changes nothing. Returns whether anything a row draws changed.
   */
  learn(list: readonly LogFeedSource[] | undefined): boolean {
    if (list === this.listed || list === undefined) {
      return false;
    }

    this.listed = list;
    let changed = false;
    for (const source of list) {
      if (source.id === '') {
        continue;
      }

      const label = source.label === undefined || source.label === '' ? source.id : source.label;
      const known = this.tags.get(source.id);
      if (known === undefined) {
        this.tags.set(source.id, makeTag(source.id, label, this.tags.size));
        changed = true;
      } else if (label !== known.label) {
        this.tags.set(source.id, { ...known, label });
        changed = true;
      }
    }

    return changed;
  }
}
