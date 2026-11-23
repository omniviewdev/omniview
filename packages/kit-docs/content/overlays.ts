import type { Guide } from './catalog.ts';

type Token = Guide['tokens'][number];

function token(name: Token['name'], label: string, property: string): Token {
  return { name, label, property };
}

const uiType = [
  token('--ov-fg', 'Text', 'color'),
  token('--ov-font-ui', 'UI font', 'font-family'),
  token('--ov-font-features', 'UI font features', 'font-feature-settings'),
  token('--ov-fs-13', 'Body text size', 'font-size'),
  token('--ov-lh-16', 'Body line height', 'line-height'),
];

const popupEdge = [
  token('--ov-border-popup', 'Popup edge', 'border-color'),
  token('--ov-radius-popup', 'Popup corners', 'border-radius'),
];

const menuStates = [
  token('--ov-bg-popup', 'Menu surface', 'background-color'),
  token('--ov-selection-active', 'Focused menu item', 'background-color'),
  token('--ov-error-fg', 'Destructive label', 'color'),
  token('--ov-fg-disabled', 'Unavailable label', 'color'),
];

const ghostIcon = [
  token('--ov-icon', 'Command icon', 'color'),
  token('--ov-hover-toolbar', 'Ghost command hover', 'background-color'),
  token('--ov-pressed', 'Ghost command press', 'background-color'),
  token('--ov-accent', 'Command focus ring', 'outline-color'),
  token('--ov-radius-control', 'Command corners', 'border-radius'),
];

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
    tokens: [
      ...uiType,
      ...popupEdge,
      token('--ov-bg-popup', 'Card surface', 'background-color'),
      token('--ov-shadow-popup', 'Card shadow', 'box-shadow'),
      token('--ov-spacing-12', 'Card inset', 'padding'),
      token('--ov-spacing-8', 'Content row gap', 'gap'),
    ],
  },
  RowMenu: {
    category: 'Overlays',
    summary: 'RowMenu renders one action menu for the row that opened it, even in a large virtualized table.',
    guidance: [
      'Create one stable handle per table with createRowMenu. Mount RowMenu beside the table and pass the same handle to each RowMenuTrigger, together with its row and a row-specific accessible name.',
      'Give the menu its own name and return actions for the opening row. An empty action list closes it. Disabled items stay visible but arrow navigation skips them; mark destructive items explicitly so color is not the only cue.',
      'Enter, Space, or Down opens at the first available item; Up opens at the last. Arrows wrap, and Home and End jump. Escape restores trigger focus; Tab continues from the trigger. Selection closes the menu before calling the row action.',
      'The fixed popover enters the top layer where supported, so table overflow does not clip it. It aligns to the trigger’s end, flips above when needed, and scrolls if neither side fits. Its CSS sets a 180 px minimum and a maximum of 360 px or the viewport minus 8 px.',
    ],
    tokens: [
      ...uiType,
      ...popupEdge,
      ...menuStates,
      ...ghostIcon,
      token('--ov-row-target', 'Menu item and trigger height', 'min-height'),
      token('--ov-row-pad', 'Trigger offset in table cell', 'margin-block'),
      token('--ov-spacing-2', 'Menu item block inset', 'padding-block'),
      token('--ov-spacing-4', 'Separator block margin and trigger inset', 'margin-block / padding'),
      token('--ov-spacing-8', 'Menu and item insets', 'padding / margin-inline'),
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
    tokens: [
      ...uiType,
      ...popupEdge,
      ...ghostIcon,
      token('--ov-bg-dialog', 'Dialog surface', 'background-color'),
      token('--ov-shadow-popup', 'Dialog shadow', 'box-shadow'),
      token('--ov-spacing-24', 'Viewport clearance', 'inline-size / block-size'),
      token('--ov-spacing-6', 'Header block inset', 'padding-block'),
      token('--ov-spacing-12', 'Header inline inset', 'padding-inline'),
      token('--ov-spacing-8', 'Gap between title and Close', 'gap'),
      token('--ov-row-target', 'Close control size', 'width / height'),
      token('--ov-spacing-4', 'Close icon inset', 'padding'),
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
    tokens: [
      ...uiType,
      token('--ov-bg-feedback', 'Tooltip surface and edge', 'background-color / border-color'),
      token('--ov-radius-control', 'Tooltip corners', 'border-radius'),
      token('--ov-shadow-tooltip', 'Tooltip shadow', 'box-shadow'),
      token('--ov-spacing-8', 'Tooltip block inset', 'padding-block'),
      token('--ov-spacing-12', 'Tooltip inline inset', 'padding-inline'),
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
    tokens: [
      ...uiType,
      token('--ov-control-height', 'Tab minimum height', 'min-height'),
      token('--ov-radius-tab', 'Tab corners', 'border-radius'),
      token('--ov-tab-bg', 'Selected tab fill', 'background-color'),
      token('--ov-tab-border', 'Selected tab edge', 'border-color'),
      token('--ov-hover-toolbar', 'Tab hover', 'background-color'),
      token('--ov-accent', 'Tab and panel focus ring', 'outline-color'),
      token('--ov-icon', 'Unselected tab icon', 'color'),
      token('--ov-fg-muted', 'Count', 'color'),
      token('--ov-spacing-4', 'Tab gap and block inset', 'gap / padding-block'),
      token('--ov-spacing-6', 'Strip block inset', 'padding-block / scroll-padding'),
      token('--ov-spacing-12', 'Tab inline inset', 'padding-inline'),
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
    tokens: [
      token('--ov-spacing-2', 'Gap step 2', 'gap'),
      token('--ov-spacing-4', 'Gap step 4', 'gap'),
      token('--ov-spacing-6', 'Gap step 6', 'gap'),
      token('--ov-spacing-8', 'Gap step 8', 'gap'),
      token('--ov-spacing-12', 'Gap step 12', 'gap'),
      token('--ov-spacing-16', 'Gap step 16', 'gap'),
      token('--ov-spacing-20', 'Gap step 20', 'gap'),
      token('--ov-spacing-24', 'Gap step 24', 'gap'),
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
    tokens: [
      token('--ov-link', 'Link text', 'color'),
      token('--ov-accent', 'Link focus ring', 'outline-color'),
      token('--ov-font-code', 'Identifier font', 'font-family'),
      token('--ov-fs-13', 'Identifier text size outside headings', 'font-size'),
      token('--ov-lh-18', 'Identifier line height outside headings', 'line-height'),
    ],
  },
  PageHeader: {
    category: 'Layout',
    summary: 'PageHeader lays out the page heading, optional breadcrumb and identity details, and a responsive command lane.',
    guidance: [
      'Supply a nonblank title and keep the default level for the page’s one h1. Give path entries clear labels; the last is marked as the current page. Add a kind tile and lifecycle state only where they identify the object.',
      'Show up to four identity facts, or use a plain note for a flow without identity details. The identity line does not wrap; long text clips where space runs out while copy controls keep their size.',
      'Commands appear as primary, up to two secondary, danger, icon-only utility, and overflow. Additional secondary items move to the shared RowMenu. Keep labels short; the command lane moves below the identity at narrow container widths.',
      'Use disabledReason when a command should remain reachable while unavailable. The first reason from a visible primary, secondary, or danger command also appears in the identity line.',
      'Pass null for an idle operation slot and a record to present progress or an outcome. The slot does not add a row; below 1000 px an active inline operation takes the space of the facts and the reason, while state stays visible.',
    ],
    tokens: [
      ...uiType,
      ...popupEdge,
      ...menuStates,
      token('--ov-fs-18', 'Heading size', 'font-size'),
      token('--ov-lh-24', 'Heading line height', 'line-height'),
      token('--ov-fs-12', 'Secondary text size', 'font-size'),
      token('--ov-fg-muted', 'Subtitle and notes', 'color'),
      token('--ov-fg-secondary', 'Facts and alternate progress fill', 'color / background-color'),
      token('--ov-font-code', 'Identifier font', 'font-family'),
      token('--ov-link', 'Breadcrumb and progress highlight', 'color / background-image'),
      token('--ov-bg-inline', 'State badge surface', 'background-color'),
      token('--ov-border-subtle', 'State badge edge', 'border-color'),
      token('--ov-radius-control', 'Badge and command corners', 'border-radius'),
      token('--ov-accent', 'Focus ring, primary command and progress fill', 'outline-color / background-color'),
      token('--ov-fg-over-accent', 'Primary command label', 'color'),
      token('--ov-border-control', 'Secondary command edge', 'border-color'),
      token('--ov-hover-row', 'Secondary command hover', 'background-color'),
      token('--ov-hover-toolbar', 'Secondary command press and ghost hover', 'background-color'),
      token('--ov-icon', 'Command and neutral kind icon', 'color'),
      token('--ov-brand-blue', 'Blue kind glyph', 'color'),
      token('--ov-control-height', 'Command and operation height', 'min-block-size'),
      token('--ov-row-target', 'Overflow menu item height', 'min-height'),
      token('--ov-progress-track', 'Operation track', 'background-color'),
      token('--ov-radius-mark', 'Progress track and fill corners', 'border-radius'),
      token('--ov-spacing-2', 'Title and badge block inset', 'padding-block'),
      token('--ov-spacing-4', 'Breadcrumb, fact and operation gaps', 'gap'),
      token('--ov-spacing-6', 'State badge inline inset', 'padding-inline'),
      token('--ov-spacing-8', 'Header, commands and operation gaps', 'gap'),
      token('--ov-spacing-12', 'Grid and operation spacing', 'column-gap / margin-inline'),
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
    tokens: [
      ...uiType,
      ...ghostIcon,
      token('--ov-border-subtle', 'Heading lane rule', 'border-bottom-color'),
      token('--ov-fg-muted', 'Meta text', 'color'),
      token('--ov-fs-12', 'Meta text size', 'font-size'),
      token('--ov-spacing-8', 'Lane and action gaps', 'gap'),
      token('--ov-spacing-6', 'Heading lane block inset', 'padding-block'),
      token('--ov-spacing-12', 'Optional body block inset', 'padding-block'),
      token('--ov-row-target', 'Row action height', 'height'),
      token('--ov-row-pad', 'Action offset in heading lane', 'margin-block'),
    ],
  },
} satisfies Record<string, Guide>;
