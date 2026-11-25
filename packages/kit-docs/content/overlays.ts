import type { Guide } from './catalog.ts';

export const entries = {
  HoverCard: {
    category: 'Overlays',
    summary: 'HoverCardHost shows a named, non-modal dialog for supplementary detail and actions attached to a trigger.',
    guidance: [
      'Mount one HoverCardHost at the application root, under any providers its content needs. Use hoverCard(key) on a focusable trigger and hoverCardAnchor() on an ancestor when the card should align to the whole item.',
      'Return a label and React content from render(key), or undefined when no card exists. Put hooks and subscriptions in a component inside the content, not in render.',
      'Hover and keyboard-visible focus normally open the card after 500 ms, without moving focus into it. For interactive content, opt in with arrow: down and supply a short announcement explaining how to reach the actions. Escape closes the card and returns focus from inside it.',
      'The native popover stays in the React tree but draws in the browser top layer. It opens below the anchor or flips above; it caps its width at 336 px and scrolls its body if height is constrained.',
    ],
  },
  Menu: {
    category: 'Overlays',
    summary: 'MenuHost renders command dropdowns and context menus on demand from delegated triggers.',
    guidance: [
      'Mount one MenuHost per document. Pass static definitions in its menus prop, keyed by ID, or call useMenu(definition, revision?) in a descendant for live commands. Use the returned ID with menuTrigger. Resolvers run only on open, and the menu keeps that opening’s items. Change the optional revision when an open snapshot becomes stale.',
      'Spread menuTrigger(id, contextKey?) onto a native button, Button, or IconButton. Give icon-only buttons an accessible name that identifies their target. Share one definition across repeated rows and pass each record’s stable key, not its position. For a context menu, use menuTrigger(id, contextKey, \'context\') on a keyboard-focusable target. Use data-ov-menu-label to name the popup separately.',
      'Use actions, checkboxes, radio groups, groups, separators, and submenus for commands, not as a substitute for a value picker. Give entries stable IDs unique among siblings. Shortcut labels and key hints describe existing bindings; they do not create them. Use explicit verbs for destructive actions. A disabled item can explain why it is unavailable without becoming actionable.',
      'Enter, Space, or Down opens a dropdown at its first available item; Up opens at the last. Use the Context Menu key or Shift+F10 on a context trigger. Pointer opening focuses the menu itself unless the trigger sets data-ov-menu-pointer-focus="first". Within a menu, use Up and Down to wrap, Home and End to jump, and typeahead to find a label. Arrow and page navigation skip disabled items, but typeahead can focus them to expose their reason.',
      'Use the inline forward and back arrows to enter and leave submenus. Escape closes one level at a time. Tab closes the menu and continues from the trigger. Selection closes the menu and returns focus before running the action. A removed or recycled trigger does not regain focus.',
      'The host mounts only the open menu and its open submenu branch. It uses the top layer where supported while keeping the popup inside its containing dialog or popover. Placement follows the trigger or context point and constrains the popup to the viewport. The item list scrolls when needed.',
    ],
  },
  Sheet: {
    category: 'Overlays',
    summary: 'Sheet opens a modal with a named header, a Close control, and a body laid out by the caller.',
    guidance: [
      'Render Sheet only while open. Give it a visible title and handle onClose by unmounting it. Escape and Close request dismissal; pressing outside does not.',
      'The native dialog enters the browser top layer without a portal and makes the rest of the page inert. Tab wraps inside. Focus the opener before mounting if pointer activation does not focus it; Sheet restores it on close if focus is otherwise lost and the opener still exists.',
      'Close is the first control; content can take initial focus when the task calls for it. Keep draft state above Sheet if it must survive closing and reopening.',
      'The centered frame is at most 1060 × 640 px and shrinks to leave 24 px on each side. The body fills the space under the header, clips overflow, and adds no padding. Put scrolling and padding in the body layout.',
    ],
  },
  TooltipHost: {
    category: 'Overlays',
    summary: 'TooltipHost shows plain-text hints and full values for clipped text through a single native popover.',
    guidance: [
      'Mount TooltipHost once at the application root. Add tip(text) to an existing trigger, or use data-ov-clip on text that should show a tip only when it clips.',
      'Name icon-only controls independently and keep essential facts available without a tooltip. Use HoverCard for links and buttons; tooltips contain only text and preserve line breaks.',
      'Pointer hover normally waits 500 ms; data-ov-tip-delay="0" opens immediately. Keyboard-visible focus opens immediately too. Escape hides the tooltip without swallowing the key. For a tip that repeats the trigger’s aria-label, the host does not add a second description.',
      'The popover draws in the browser top layer rather than a portal. Text wraps within a 300 px cap or a narrower viewport, and the text body scrolls if height is constrained.',
    ],
  },
  Tabs: {
    category: 'Navigation',
    summary: 'Tabs switches sections within one page and pairs with a single caller-rendered TabPanel.',
    guidance: [
      'Give the tablist an accessible label and each tab a stable id. Own selected and onSelect in the calling view, and give Tabs and TabPanel the same base id and selected value.',
      'Use the panel to render the selected content. It takes its accessible name from the selected tab and remains a Tab stop even if its content is only text.',
      'Tab enters the strip once. Left and Right wrap, and Home and End jump to the ends. Moving focus with those keys also selects the tab. The strip scrolls horizontally without wrapping and brings the focused tab into view.',
      'Use text labels; an icon or count can supplement the label. Zero is a visible count, not an absent count.',
    ],
  },
  RovingGroup: {
    category: 'Navigation',
    summary: 'RovingGroup makes a named set of controls one Tab stop while leaving their appearance and activation to the children.',
    guidance: [
      'Provide a label for the set. Compose buttons, links, or supported custom items; use role="toolbar" for a toolbar that should expose its orientation.',
      'Left and Right move through a row; Up and Down move through a column. They stop at the ends. Home and End jump to the ends, and Tab leaves the group. Use wrap and align for layout, not to change keyboard order.',
      'The last focus position takes precedence, then a current, selected, or pressed item, then a checked item, then the first. Reasoned aria-disabled controls stay reachable; natively disabled controls and items with hidden set are skipped.',
      'Only the gap has tokens here. Focus rings, fills, and typography belong to the controls inside the group.',
    ],
  },
  Link: {
    category: 'Navigation',
    summary: 'Link is a native anchor for a host destination, with navigation delegated to LinkProvider.',
    guidance: [
      'Use Link for destinations and Button for commands. Place a LinkProvider above it: hrefOf supplies a real, copyable URL, and onOpen decides how to navigate for the target and activation modifiers.',
      'Enter and primary click invoke the host, as does middle click. Right click keeps the native context menu. Use link text that names the destination, not just its color or position.',
      'Provide a non-color cue for links embedded in running text. Kit Link is not underlined at rest.',
      'Normal text stays inline and inherits its type. Use mono for identifiers. In a constrained row, wrap a long name in MiddleEllipsis to keep its suffix visible and its full text accessible.',
    ],
  },
  PageHeader: {
    category: 'Layout',
    summary: 'PageHeader lays out the page heading, optional breadcrumb and identity details, and a responsive command lane.',
    guidance: [
      'Supply a nonblank title and keep the default level for the page’s one h1. Give path entries clear labels; the last is marked as the current page. Add a kind tile and lifecycle state only where they identify the object.',
      'Show up to four identity facts, or use a plain note for a flow without identity details. The identity line does not wrap; long text clips where space runs out while copy controls keep their size.',
      'Commands appear as primary, up to two secondary, danger, icon-only utility, and overflow. The window’s MenuHost renders overflow from additional secondary commands and commands.menu. Items already visible as buttons are omitted by ID, and the trigger is hidden when no entries remain. Keep labels short; the command lane moves below the identity at narrow container widths.',
      'Use disabledReason when a command should remain reachable while unavailable. The first reason from a visible primary, secondary, or danger command also appears in the identity line.',
      'Pass null for an idle operation slot and a record to present progress or an outcome. The slot does not add a row; below 1000 px an active inline operation takes the space of the facts and the reason, while state stays visible.',
    ],
  },
  SectionCard: {
    category: 'Layout',
    summary: 'SectionCard gives a page section a heading lane and an optional inset body, without adding a filled container.',
    guidance: [
      'Use level 2 under the page heading, or level 3 or 4 when the section is nested. The heading level changes the outline, not the visual treatment.',
      'Keep meta short, such as a count or scope. Put trailing controls in actions and prefer ghost row-size buttons to preserve the default heading lane height. Give any icon-only action an accessible label.',
      'Use pad for text, chips, or key-value rows that need a 12 px block inset. Leave it off for tables that should sit flush below the rule. A long title clips before the trailing actions.',
    ],
  },
} satisfies Record<string, Guide>;
