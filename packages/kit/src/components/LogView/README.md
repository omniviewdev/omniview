# `LogView`

The log viewer: a find bar, a level quick filter, a windowed list of lines and a status strip over a `LogFeed` (design 16 S120). `docs/ui-next/optimisations.md` section 3 is the list of what it must not regress; the status files `P1b-2.md` (the part), `L1.md` (dropped lines) and `L2.md` (sources and order) say how it was built and measured.

## What order means

**The lines are in the order the feed gave them: arrival order.** `LogFeedLine.seq` numbers them from 1 as they came; the view shows them in that order and never sorts them.

With one source the arrival order and the order of the clocks are the same. With several sources they are not: the lines of a service's instances or an application's processes come interleaved, each source's lines are in its own clock order, and a line can carry a timestamp earlier than the line above it. The first real stream showed 110 of 2,225 rows like that. The clock column is what the source reported; the row's place is when the line reached the view.

The view does not sort because a live tail cannot: a sorted view would hold every line back until no earlier one can still arrive, and nothing says when that is. The command-line tools that follow several streams at once print them in arrival order as well. What follows from it:

- Anything that reads the clock as a position (a jump to a time, a range) treats it as approximate when the log has more than one source (the old viewer's `findEntryIndexByTime` already assumed arrival order, HLT-13).
- A line the view shows is never moved after it is drawn: a row, a selection, a match and the reader's place are named by the line's ordinal in the view, which does not change.

## Sources

A line may name its source (`LogFeedLine.source`, an id such as `orders-api/app`; `''` names none). A feed may also list the sources it follows (`LogFeedSnapshot.sources`: an id and, if it has one, a `label`). The view has **heard of** a source from either, whichever comes first.

- **One source (or none): nothing extra.** The rows are the clock, the level and the text; three column heads and `aria-colcount` 3.
- **More than one: a Source column**, between the level and the text, 168 px wide as the mock's is (`shell-panel.css` 103). Each row says its source in a chip: the name as text, cut from its start when it does not fit so that its end, which tells it from the others, stays (`MiddleEllipsis`, the kit's tooltip rule: the whole name is the tip while it is cut), and an 8 px swatch in the hue of the source's place in a series of seven (blue, green, amber, purple, cyan, red, gray: the mock's `SRC_COLORS`; the eighth source takes blue again). The swatch is never what says which source it is: the name is text. A line that names no source has an empty cell.
- **The column appears in the one commit that carries the second source** (a line, or the feed's listing) and **never goes away**, even when the lines of the second source have left the buffer, so the shape of the log does not change under a reader. Rows are a fixed height, so nothing moves vertically: no scroll command is issued for it, the window is the same, and no geometry is measured again.
- **The name** of a source is the `label` the feed's latest listing gives it, else its id: a label that goes away is the id again (the host's card names sources from the same listing, so the rows and the card say the same), a label that arrives later changes the tag of that source only, and a source the feed no longer lists keeps its last name (its lines are still in the log). A source keeps its hue for the life of the view.
- **The tip of a cut name** is the kit's (`TooltipHost`): the whole name, after the delay, while the name is cut. The host closes a tip on a scroll of anything that holds its trigger, and a list that follows a live stream scrolls on every line it draws, so a tip does not open in a list that is following a fast stream: it opens in a list that stands still (paused, ended, or scrolled back).
- **Search matches the text of a line only**, as the mock's does (`shell-panel.js` 1668 and 1953 test the message): a query that is only in a source's name finds nothing.
- **Copy carries the source while the column shows**: `clock LEVEL label  text`, the level padded to five and two spaces after the label, as the mock's `lineText` copies a line (`shell-panel.js` 2062). With one source the copy is `clock LEVEL text`, as it always was. (The mock copies the label whenever a line has one; showing the column is the condition here so that a single-source log is exactly what it was. Following the mock to the letter is one condition in `LogViewModel.copyText`.)

Not built yet (P1b-4, the panel's toolbar): a control to filter by source, and the mock's display option to show or hide the column.
