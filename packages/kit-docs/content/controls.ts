import type { Guide } from './catalog.ts';

const category = 'Controls';

export const entries = {
  Button: {
    category,
    summary: 'Button triggers an action. Use Link for navigation and IconButton for an action presented without visible text.',
    guidance: [
      'Use a short label that says what the action does.',
      'Reserve primary emphasis for the main action in a group. Secondary is the default; use ghost for quiet toolbar commands and tone="danger" for destructive actions.',
      'Use disabledReason when an unavailable action should explain why. The button stays focusable but cannot activate; show the same reason beside it.',
      'Enter and Space activate the native button. Button does not submit a form.',
      'Use size="compact" for tighter side padding or size="row" within table rows. Use icon to add a decorative glyph before the label.',
      'busy announces work immediately and replaces an existing glyph after one second. It does not block activation or change the label.',
    ],
  },
  IconButton: {
    category,
    summary: 'Use an icon-only command for a familiar toolbar or row action. Use Button if visible text is needed.',
    guidance: [
      'Provide a label that names the action and its target, such as “Copy name.” The glyph is not the accessible name.',
      'Enter and Space activate it. disabledReason prevents activation without removing the tab stop; show the reason nearby.',
      'For a mode such as Match case, pass pressed and update it in onClick. Keep the label the same in both states; omit pressed for a plain command.',
      'Set popup="menu" for a menu trigger. Let the menu manage expanded state and its relationship to the trigger.',
      'Use size="row" for a compact row target. busy swaps the glyph for a loader after one second but does not block activation.',
    ],
  },
  Field: {
    category,
    summary: 'Pair one Kit form control with a persistent label, help, and a message lane. Field does not own the value.',
    guidance: [
      'Use aligned for side-by-side forms, stacked for long controls, and row for settings. Only row accepts a trailing command or status slot.',
      'Use help for standing instructions and aside for a short note such as “optional.” The visible label names the control; help and the lane describe it.',
      'Set required for a required value. Use a message with kind="error" to mark supporting controls invalid; describe the problem and how to fix it.',
      'Set lane to reserve room before messages appear. For a failed check, set message.retry and supply onRetry to offer a keyboard-accessible Retry button.',
      'Use readOnly for a value users cannot edit. Use disabledReason for a change that is currently unavailable; the reason becomes a control description.',
    ],
  },
  TextInput: {
    category,
    summary: 'Edit a single line of text. Keep draft and applied values separate when edits need an explicit commit.',
    guidance: [
      'Provide Field or a standalone label; placeholder is a hint, not a name.',
      'Update value through onValueChange. Wire onCommit for Enter and onBlur for commit on focus exit. Set dirty and onRevert to restore the applied value on Escape.',
      'Use maxLength for a length limit and allows to reject disallowed inserted text. allows does not validate the whole value or filter composition.',
      'Use mono for identifiers or addresses. Pick short, normal, wide, or fill for the available space. Use readOnly for selectable facts and disabledReason for unavailable edits.',
    ],
  },
  NumberInput: {
    category,
    summary: 'Edit a number with a single-tab-stop spinbutton and pointer step controls. Keep the draft as a string so incomplete input stays editable.',
    guidance: [
      'Provide Field or a standalone label. Set min, max, and step for the valid grid, anchored at min or zero. Use unit for a suffix such as “px.”',
      'Up and Down change one step. Page Up and Page Down change about one tenth of a bounded range, or ten steps without both bounds.',
      'Enter and successful steps call onCommit. Use onBlur for focus-exit handling and dirty with onRevert to restore a draft on Escape.',
      'Validate the draft yourself and explain errors in Field. Typing never clamps the value; keyboard steps require a valid number, but pointer steps clamp their result to the bounds.',
    ],
  },
  SecretInput: {
    category,
    summary: 'Set or replace a password, key, or token without loading the saved secret into the input.',
    guidance: [
      'Pass presence as set or unset, never the saved secret. Replace opens an empty input; Show reveals only the newly typed text.',
      'Send the draft to your model through onValueChange and track changed there. Set changed to false after applying or reverting a draft to clear and remask the input.',
      'Use Field or a standalone label so the input and its actions have a name. Enter calls onCommit; Escape or Cancel exits replacement and calls onRevert for a draft.',
      'onBlur fires when focus leaves the composite control, not when it moves to a Show or Replace button.',
    ],
  },
  SearchField: {
    category,
    summary: 'Search from a toolbar with a controlled query, a clear action, and an optional in-content match count.',
    guidance: [
      'Give label a target, such as “Search items.” The placeholder defaults to that label. Keep query state and any debounce in the caller.',
      'Use onValueChange for edits and clears. Enter calls onSubmit when supplied, so a deferred search can run now.',
      'Escape clears a nonempty query; empty Escape reaches the page. The pointer clear button restores input focus and adds no tab stop.',
      'Pass count for an in-content result such as “3 of 12”; pass an empty string to keep its lane reserved. For invalid queries, use invalid and put the explanation in the count lane.',
    ],
  },
  Select: {
    category,
    summary: 'Choose one value from a short list of text options. The browser supplies the menu and keyboard behavior.',
    guidance: [
      'Use Field or a standalone label. Pass options with distinct string values and plain-text labels; pass disabled on options users cannot choose.',
      'Keep value controlled and apply changes through onValueChange. Use placeholder for an unmatched value, not as a selectable option.',
      'Use width="normal" for an intrinsic settings-row width or fill to span the slot. Use mono for identifiers.',
      'readOnly and disabledReason keep the control focusable but prevent opening or changing it. Use Field help or a message to explain the restriction.',
    ],
  },
  Toggle: {
    category,
    summary: 'Use a switch for a binary setting that applies immediately.',
    guidance: [
      'Keep checked in the model and apply onCheckedChange immediately. Keep the Field label or standalone label the same in both states.',
      'The switch has one tab stop. Enter and Space request the opposite state, and assistive technology reads the current checked state.',
      'Use disabledReason for an unavailable change or readOnly for a fixed value. Both keep the switch focusable without letting it change.',
    ],
  },
  SegmentedControl: {
    category,
    summary: 'Choose one option from a few joined buttons, such as a view mode.',
    guidance: [
      'Name the choice with label. Own value and update it in onValueChange. Give each option a stable value.',
      'Use text labels, with an optional icon. An icon-only option needs a tip, which is its accessible name.',
      'The group is one Tab stop. The arrows move to the next available option and choose it; Home and End go to the ends. It scrolls sideways instead of wrapping.',
      'Use disabledReason on an option to explain why it cannot be chosen. Arrows skip it, and the tooltip and description say why.',
    ],
  },
  SwatchPicker: {
    category,
    summary: 'Choose one color from a short row of data-palette swatches.',
    guidance: [
      'Give each option a color from the data palette and a name such as “Blue” as its label. Name the group with label, or put it in a Field.',
      'Own value; null means the default color and checks nothing. onValueChange is not called for the color that is already chosen.',
      'The chosen swatch shows a ring and a check mark, so color is never the only cue. The group is one Tab stop; arrows only move focus, and Enter or Space chooses.',
      'A swatch with disabledReason stays reachable and explains itself in its tooltip and description. Offer the command that returns to the default color beside the picker.',
    ],
  },
  Checkbox: {
    category,
    summary: 'A native checkbox for a choice that is kept with a form’s other values.',
    guidance: [
      'Own checked and apply onCheckedChange. A click on a mixed box asks for true. Use "mixed" for a choice that covers some of a set.',
      'Give it a label. Without one the box is bare, and a Field’s label names it.',
      'Use readOnly for a fixed value, or disabledReason for an unavailable change. Both keep the box focusable without letting it change; show the same reason where the user reads the page.',
      'Use Toggle for a setting that applies at once.',
    ],
  },
  FileButton: {
    category,
    summary: 'A button that opens the system file picker.',
    guidance: [
      'Label it with a verb in sentence case, such as “Import image…”. It is one Tab stop and reads like a button.',
      'accept filters the picker; it is not a check. Validate, read, and limit the files in onFiles, which receives at least one file and never none.',
      'Use multiple to allow more than one file. The same file can be picked twice in a row.',
      'Use busy while the caller works on the files, and disabledReason to explain why the button is unavailable. Either stops the picker from opening.',
    ],
  },
  ValuePicker: {
    category,
    summary: 'Choose several values from a list that may be long, with a trigger, a search field, and checkable options.',
    guidance: [
      'Name what is chosen with label. Own value, the chosen values in the order they were chosen, and replace it in onValueChange. Each change applies at once and the popup stays open.',
      'Use allOption for a filter that means no narrowing, such as “All platforms”. It is the first row and the trigger’s text while nothing is chosen; otherwise the trigger says “None selected”.',
      'Give options a description for a second line, or disabledReason to keep an option listed but unavailable. The search reads label, description, or the reason.',
      'Focus stays in the search field: Up and Down move through options, Enter chooses, Escape closes and returns focus. Turn searchable off for a short list.',
      'Use Select to choose one value. Use disabledReason on the picker when it cannot change.',
    ],
  },
  FormActions: {
    category,
    summary: 'The lane of commands at the end of a dialog, drawer, or form.',
    guidance: [
      'Pass the form’s main command as primary, up to two secondary commands, and cancel. They render in that order, with the primary last and filled.',
      'Label commands with sentence-case verbs, never with a count. Use disabledReason on a command that cannot run; it stays in the Tab order. busy marks a command in flight without changing its label.',
      'Use tone="danger" when the primary removes or loses something. Use lead for a short muted note or operation state at the start of the lane.',
      'autoFocus is for dialogs only: use cancel where the safe answer should be under Enter. The lane has no label; the dialog or form around it provides one.',
    ],
  },
} satisfies Record<string, Guide>;
