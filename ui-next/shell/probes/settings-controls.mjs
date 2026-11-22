// The negative controls of the Settings probe (settings-probe.mjs): each breaks ONE behaviour of the page in one way (a rule that moves a box, an attribute that goes, a handler that is dropped, a listener that stays), runs the part of
// the probe that must see it, and must trip the assertion it is named for and no other. `says` is that assertion (the name that starts each failure); `parts` the parts of the section that run; `plant` the perturbation the part lays over
// the page once it is drawn (see `plant` in settings-lib.mjs: `css`, `js` with `arg`, and the `stage` it applies at). Run one with NEGATIVE_CONTROL=<name>; with ASSERTION_OFF=says the same fault must pass undetected (rule 28).
//
// `base` is the perturbation of the CLEAN run, for an assertion that the real page does not satisfy yet (a finding of the probe, not a fault of a control): the clean run is the page repaired by the stylesheet or script of `base`, where
// the assertion must be silent, and the perturbed run is the page with its fault laid over the repair. A control whose assertion the real page satisfies has no `base`.

/** What a page does with the scroll of the page before it: `arg` is where it opens, 175 px down (the page keeps the last one's scroll, as it does today: a fault) or 0 (the repair). */
const SCROLL = (top) => {
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('[data-settings-part="nav"] button') !== null) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const content = document.querySelector('[data-settings-part="content"]');
            if (content !== null) content.scrollTop = top;
          }),
        );
      }
    },
    true,
  );
};

export const PERTURBATIONS = {
  // ---------------------------------------------------------------- window
  'win-sidebar': {
    section: 'window',
    parts: ['old'],
    says: /^window\.old\.match /,
    fault: 'the sidebar is 200 px wide, not the original window\'s 212',
    plant: { css: '[data-settings-part="nav"] { inline-size: 200px !important; }' },
  },
  'win-caption': {
    section: 'window',
    parts: ['old'],
    says: /^window\.old\.decided /,
    fault: 'the caption is 56 px high, as the original window\'s brand row was, which nobody decided',
    plant: { css: '[data-settings-part="caption"] { min-block-size: 56px !important; }' },
  },
  'win-shell': {
    section: 'window',
    parts: ['bare'],
    says: /^window\.bare /,
    fault: 'a dialog is open in the window: the window draws more than Settings',
    plant: { js: () => document.body.insertAdjacentHTML('beforeend', '<dialog open data-ghost="dialog"></dialog>') },
  },
  'win-drag': {
    section: 'window',
    parts: ['drag'],
    says: /^window\.drag /,
    fault: 'Close takes the drag of its caption, so a press on it would move the window',
    plant: { css: '[data-settings-part="caption"] button { --wails-draggable: drag !important; }' },
  },
  'win-escape': {
    section: 'window',
    parts: ['keys'],
    says: /^window\.keys /,
    fault: 'Escape never reaches the window\'s handler',
    plant: { js: () => window.addEventListener('keydown', (event) => event.key === 'Escape' && event.stopImmediatePropagation(), true) },
  },
  'win-hidden-paints': {
    section: 'window',
    parts: ['request'],
    says: /^window\.request /,
    fault: 'a hidden window is still laid out and painted',
    plant: { css: '[data-settings-part="window"][data-visible="false"] { content-visibility: visible !important; }' },
  },
  'win-sync-dropped': {
    section: 'window',
    parts: ['sync'],
    says: /^window\.sync /,
    fault: 'the window stops listening to the host: a change somebody else makes never arrives',
    plant: { js: () => window.__stops.changed.forEach((stop) => stop()) },
  },

  // ---------------------------------------------------------------- page
  'nav-height': {
    section: 'page',
    parts: ['nav'],
    says: /^page\.nav /,
    fault: 'a page\'s row in the navigation is 34 px high, as the original window\'s were',
    plant: { css: '[data-settings-part="nav"] button { block-size: 34px !important; }' },
  },
  'nav-selected-paint': {
    section: 'page',
    parts: ['navstates'],
    says: /^page\.navstates /,
    fault: 'the page on screen is painted in a colour that is no role of the theme',
    plant: { css: '[data-settings-part="nav"] [aria-current="page"] { background-color: rgb(200, 0, 0) !important; }' },
  },
  'group-size': {
    section: 'page',
    parts: ['group'],
    says: /^page\.group\.size /,
    fault: 'the group\'s label is 12 px muted in a 28 px row, as it is today, not the mock\'s 13 px in the text colour in a 24 px row',
    plant: { css: '[data-settings-part="nav"] > [aria-hidden="true"] { font-size: var(--ov-fs-12) !important; color: var(--ov-fg-muted) !important; padding-block: 6px !important; }' },
  },
  'group-tabbable': {
    section: 'page',
    parts: ['group'],
    says: /^page\.group\.label /,
    fault: 'the group\'s label is a Tab stop',
    plant: { js: () => document.querySelector('[data-settings-part="nav"] > [aria-hidden="true"]').setAttribute('tabindex', '0') },
  },
  'heading-lane': {
    section: 'page',
    parts: ['heading'],
    says: /^page\.heading\.lane /,
    fault: 'the heading has a 24 px title lane and no gap under it, as it does today, not the mock\'s 28 px lane and 4 px gap',
    plant: { css: '[data-settings-part="page"] > header > :first-child { min-block-size: 24px !important; } [data-settings-part="page"] > header { gap: 0 !important; }' },
  },
  'heading-type': {
    section: 'page',
    parts: ['heading'],
    says: /^page\.heading\.type /,
    fault: 'the page title is 22 px',
    plant: { css: '[data-settings-part="page"] > header > :first-child { font-size: 22px !important; }' },
  },
  'heading-oneline': {
    section: 'page',
    parts: ['heading'],
    says: /^page\.heading\.oneline /,
    fault: 'the description wraps where it is long, as it does today, and is not cut to one line with an ellipsis',
    plant: { css: '[data-settings-part="page"] > header > p { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }' },
  },
  'list-start': {
    section: 'page',
    parts: ['list'],
    says: /^page\.list\.start /,
    fault: 'the rows start 20 px under the heading, not 12',
    plant: { css: '[data-settings-part="page"] > header { margin-block-end: 20px !important; }' },
  },
  'rows-height': {
    section: 'page',
    parts: ['list'],
    says: /^page\.rows\.height /,
    fault: 'a row has no lane: its height is no longer the content\'s with the 16 px the lane reserves',
    plant: { css: '[data-settings-row] [data-ov-part="lane"] { display: none !important; }' },
  },
  'rows-order': {
    section: 'page',
    parts: ['list'],
    says: /^page\.rows\.order /,
    fault: 'the first row of the page is drawn last',
    plant: { stage: 'rows', js: () => document.querySelector('[data-settings-part="rows"]').append(document.querySelector('[data-settings-part="rows"]').firstElementChild) },
  },
  'rows-pitch': {
    section: 'page',
    parts: ['list'],
    says: /^page\.rows\.pitch /,
    fault: 'there are 8 px between two rows',
    plant: { css: '[data-settings-row] + [data-settings-row] { margin-block-start: 8px !important; }' },
  },
  'rows-separator': {
    section: 'page',
    parts: ['list'],
    says: /^page\.rows\.separator /,
    fault: 'the list draws no separator between two rows',
    plant: { css: '[data-settings-row] { box-shadow: none !important; }' },
  },
  'rows-column': {
    section: 'page',
    parts: ['list'],
    says: /^page\.rows\.column /,
    fault: 'a row has no 24 px slot for its Reset',
    plant: { css: '[data-settings-row] [data-ov-part="trailing"] { display: none !important; }' },
  },
  'scroll-pane': {
    section: 'page',
    parts: ['scroll'],
    says: /^page\.scroll\.pane /,
    fault: 'a scroll that reaches the end of the page\'s pane goes on to what is behind it (overscroll-behavior auto)',
    plant: { css: '[data-settings-part="content"] { overscroll-behavior-y: auto !important; }' },
  },
  'scroll-wheel': {
    section: 'page',
    parts: ['scroll'],
    says: /^page\.scroll\.wheel /,
    fault: 'the navigation moves when the page scrolls',
    plant: {
      js: () => {
        const content = document.querySelector('[data-settings-part="content"]');
        const nav = document.querySelector('[data-settings-part="nav"]');
        content.addEventListener('scroll', () => {
          nav.style.transform = 'translateY(-12px)';
        });
      },
    },
  },
  'scroll-end': {
    section: 'page',
    parts: ['scroll'],
    says: /^page\.scroll\.end /,
    fault: 'the page has no inset under its last row',
    plant: { css: '[data-settings-part="page"] { padding-block-end: 0 !important; }' },
  },
  'scroll-reset': {
    section: 'page',
    parts: ['scroll'],
    says: /^page\.scroll\.reset /,
    fault: 'a page opens where the page before it was scrolled to (175 px), as it does today, not at the top',
    plant: { js: SCROLL, arg: 175 },
  },
  'scroll-fits': {
    section: 'page',
    parts: ['scroll'],
    says: /^page\.scroll\.fits /,
    fault: 'Appearance, which fits its pane, has 400 px more under its rows, so it scrolls',
    plant: { css: '[data-settings-part="page"][data-settings-page-id="appearance"] { padding-block-end: 400px !important; }' },
  },
  'states-loading': {
    section: 'page',
    parts: ['states'],
    says: /^page\.states\.loading /,
    fault: 'the loading line is not a status',
    plant: { js: () => document.querySelector('[data-settings-state="loading"]')?.removeAttribute('role') },
  },
  'states-failed': {
    section: 'page',
    parts: ['states'],
    says: /^page\.states\.failed /,
    fault: 'the keyboard is not on Retry when the alert appears',
    plant: { js: () => document.activeElement instanceof HTMLElement && document.activeElement.blur() },
  },
  'states-empty': {
    section: 'page',
    parts: ['states'],
    says: /^page\.states\.empty /,
    fault: 'the line that says the host has no settings is an alert',
    plant: { js: () => document.querySelector('[data-settings-state="empty"]')?.setAttribute('role', 'alert') },
  },
  'states-anatomy': {
    section: 'page',
    parts: ['states'],
    says: /^page\.states\.anatomy /,
    fault: 'there are 20 px between the lines of the alert, not 8',
    plant: { css: '[data-settings-state="failed"] { row-gap: 20px !important; }' },
  },
  'states-type': {
    section: 'page',
    parts: ['states'],
    says: /^page\.states\.type /,
    fault: 'the alert\'s sentence is 13 px, as it is today, not the mock\'s 12 px, and its text is not centred',
    plant: { css: '[data-settings-state="failed"] > :nth-child(2) { font-size: var(--ov-fs-13) !important; } [data-settings-state="failed"] { text-align: start !important; }' },
  },
  'paint-token': {
    section: 'page',
    parts: ['paint'],
    says: /^page\.paint /,
    fault: 'in Obsidian the page on screen is painted in a colour that is no role of the theme',
    plant: { css: 'html[data-ov-theme="obsidian"] [data-settings-part="nav"] [aria-current="page"] { background-color: rgb(1, 2, 3) !important; }' },
  },

  // ---------------------------------------------------------------- sheet
  'sheet-gear-name': {
    section: 'sheet',
    parts: ['closed'],
    says: /^sheet\.closed /,
    fault: 'the gear has no name',
    plant: { js: () => document.querySelector('[data-shell-part="settings"]').removeAttribute('aria-label') },
  },
  'sheet-open-chord': {
    section: 'sheet',
    parts: ['open'],
    says: /^sheet\.open /,
    fault: 'the chord and the gear ask the control to open, and it does nothing',
    plant: { js: () => Object.assign(window.__control, { open: () => undefined }) },
  },
  'sheet-not-modal': {
    section: 'sheet',
    parts: ['modal'],
    says: /^sheet\.modal /,
    fault: 'the dialog is shown without being modal, so the page behind takes the focus',
    plant: {
      js: () => {
        const dialog = document.querySelector('dialog[open]');
        dialog.close();
        dialog.show();
      },
    },
  },
  'sheet-frame-size': {
    section: 'sheet',
    parts: ['frame'],
    says: /^sheet\.frame /,
    fault: 'the frame is 1000 px wide',
    plant: { css: '[data-ov-part="frame"] { inline-size: 1000px !important; }' },
  },
  'sheet-no-clamp': {
    section: 'sheet',
    parts: ['clamp'],
    says: /^sheet\.clamp /,
    fault: 'the frame is 1060 x 640 in a window that is smaller',
    plant: { css: '[data-ov-part="frame"] { inline-size: 1060px !important; block-size: 640px !important; }' },
  },
  'sheet-veil': {
    section: 'sheet',
    parts: ['paint'],
    says: /^sheet\.paint /,
    fault: 'a veil is drawn over the page behind the sheet (the frame is positioned above it, as a part that drew one would have to)',
    plant: { css: '[data-settings-part="sheet"]::before { content: ""; position: absolute; inset: 0; background-color: var(--ov-bg-dialog); opacity: 0.5; } [data-ov-part="frame"] { position: relative; }' },
  },
  'sheet-no-wrap': {
    section: 'sheet',
    parts: ['trap'],
    says: /^sheet\.trap /,
    fault: 'Tab never reaches the part: the engine alone moves the focus',
    plant: { js: () => window.addEventListener('keydown', (event) => event.key === 'Tab' && event.stopImmediatePropagation(), true) },
  },
  'sheet-scrim-closes': {
    section: 'sheet',
    parts: ['scrim'],
    says: /^sheet\.scrim /,
    fault: 'a press on the scrim sends the dialog the close request that Escape sends',
    plant: { js: () => document.addEventListener('pointerdown', (event) => event.target instanceof HTMLDialogElement && event.target.dispatchEvent(new Event('cancel', { cancelable: true })), true) },
  },
  'sheet-escape-draft': {
    section: 'sheet',
    parts: ['close'],
    says: /^sheet\.draft /,
    fault: 'the field never sees Escape, so the browser sends the close request even though the field has a draft',
    plant: { js: () => window.addEventListener('keydown', (event) => event.key === 'Escape' && event.target instanceof HTMLInputElement && event.stopImmediatePropagation(), true) },
  },
  'sheet-no-restore-escape': {
    section: 'sheet',
    parts: ['close'],
    says: /^sheet\.escape /,
    fault: 'the focus is not given back to the gear after Escape',
    plant: {
      js: () => {
        const focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function patched(...args) {
          if (window.__step === 'escape' && this.matches('[data-shell-part="settings"]')) return undefined;
          return focus.apply(this, args);
        };
      },
    },
  },
  'sheet-no-restore-close': {
    section: 'sheet',
    parts: ['close'],
    says: /^sheet\.close /,
    fault: 'the focus is not given back to the gear after Close',
    plant: {
      js: () => {
        const focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function patched(...args) {
          if (window.__step === 'close' && this.matches('[data-shell-part="settings"]')) return undefined;
          return focus.apply(this, args);
        };
      },
    },
  },
  'sheet-keep-lost': {
    section: 'sheet',
    parts: ['keep'],
    says: /^sheet\.keep /,
    fault: 'the page last used is forgotten: the sheet reopens on the first page',
    plant: { js: () => Object.assign(window.__control.page, { set: () => undefined }) },
  },
  'sheet-tip-hidden': {
    section: 'sheet',
    parts: ['tip'],
    says: /^sheet\.tip /,
    fault: 'the tooltip is not drawn',
    plant: { css: '[role="tooltip"] { display: none !important; }' },
  },

  // ---------------------------------------------------------------- keys
  'keys-nav-wrap': {
    section: 'keys',
    parts: ['nav'],
    says: /^keys\.nav /,
    fault: 'ArrowDown on the last page goes round to the first',
    plant: {
      js: () => {
        const nav = document.querySelector('[data-settings-part="nav"]');
        nav.addEventListener(
          'keydown',
          (event) => {
            const buttons = [...nav.querySelectorAll('button')];
            if (event.key === 'ArrowDown' && document.activeElement === buttons.at(-1)) {
              buttons[0].focus();
              event.stopPropagation();
            }
          },
          true,
        );
      },
    },
  },
  'keys-nav-stops': {
    section: 'keys',
    parts: ['nav'],
    says: /^keys\.nav /,
    fault: 'a second page is a Tab stop of its own',
    plant: { js: () => document.querySelectorAll('[data-settings-part="nav"] button')[2].setAttribute('tabindex', '0') },
  },
  'keys-unreachable': {
    section: 'keys',
    parts: ['reach'],
    says: /^keys\.reach /,
    fault: 'a row\'s control is out of the Tab order',
    plant: { js: () => document.querySelector('[data-settings-row] select').setAttribute('tabindex', '-1') },
  },
  'keys-switch-space': {
    section: 'keys',
    parts: ['operate'],
    says: /^keys\.operate /,
    fault: 'Space on a switch is taken by something that does nothing with it',
    plant: {
      js: () => {
        const take = (event) => {
          if (event.key === ' ' && event.target instanceof Element && event.target.matches('[role="switch"]')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        };
        window.addEventListener('keydown', take, true);
        window.addEventListener('keyup', take, true);
      },
    },
  },
  'keys-select-typeahead': {
    section: 'keys',
    parts: ['select'],
    says: /^keys\.select /,
    fault: 'a key typed in a select is taken before the engine sees it',
    plant: {
      js: () =>
        window.addEventListener(
          'keydown',
          (event) => {
            if (event.target instanceof HTMLSelectElement && event.key.length === 1) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          },
          true,
        ),
    },
  },
  'keys-draft': {
    section: 'keys',
    parts: ['draft'],
    says: /^keys\.draft /,
    fault: 'the focus leaving a field is not told to the form, so a press on another page does not apply a valid draft',
    plant: { js: () => document.addEventListener('focusout', (event) => event.stopImmediatePropagation(), true) },
  },

  // ---------------------------------------------------------------- a11y
  'axe-name': {
    section: 'a11y',
    parts: ['pages'],
    says: /^a11y\.axe /,
    fault: 'Close has no accessible name',
    plant: {
      js: () => {
        document.querySelector('dialog [data-ov-part="close"], [data-settings-part="caption"] button').removeAttribute('aria-label');
      },
    },
  },
  'axe-contrast': {
    section: 'a11y',
    parts: ['pages'],
    says: /^a11y\.axe /,
    fault: 'the page\'s description is drawn almost in the colour of its background (an exact match is hidden text, which axe asks a person to review, not a violation)',
    plant: { css: '[data-settings-part="page"] > header > p { color: color-mix(in srgb, var(--ov-bg-dialog) 85%, var(--ov-fg)) !important; }' },
  },

  // ---------------------------------------------------------------- perf
  'perf-open-commits': {
    section: 'perf',
    parts: ['open'],
    says: /^perf\.open\.commits /,
    fault: 'the page is drawn again after the host\'s answer, by a second change that arrives at once',
    plant: {
      js: () => {
        const release = window.__release;
        window.__release = () => {
          release();
          window.setTimeout(() => window.__host.change('appearance.density', 'compact'), 0);
        };
      },
    },
  },
  'perf-open-slow': {
    section: 'perf',
    parts: ['open'],
    says: /^perf\.open\.frames /,
    fault: 'the answer is worked on for 60 ms before the page is drawn',
    plant: {
      js: () => {
        const release = window.__release;
        window.__release = () => {
          release();
          const started = performance.now();
          while (performance.now() - started < 60);
        };
      },
    },
  },
  'perf-show-commits': {
    section: 'perf',
    parts: ['show'],
    says: /^perf\.show\.commits /,
    fault: 'a show is followed by a change of a value, so the form is drawn again',
    plant: {
      js: () => {
        const emit = window.__windows.emit;
        let density = 0;
        window.__windows.emit = (request) => {
          emit(request);
          if (request.visible) window.setTimeout(() => window.__host.change('appearance.density', density++ % 2 === 0 ? 'compact' : 'comfortable'), 30);
        };
      },
    },
  },
  'perf-show-slow': {
    section: 'perf',
    parts: ['show'],
    says: /^perf\.show\.frames /,
    fault: 'a show is worked on for 70 ms before the window is drawn',
    plant: {
      js: () => {
        const emit = window.__windows.emit;
        window.__windows.emit = (request) => {
          emit(request);
          if (request.visible) {
            const started = performance.now();
            while (performance.now() - started < 70);
          }
        };
      },
    },
  },
  'perf-key-twice': {
    section: 'perf',
    parts: ['key'],
    says: /^perf\.key\.commits /,
    fault: 'a key updates the field a second time from the next task',
    plant: {
      js: () => {
        const form = window.__control.getSnapshot().session.getState().form;
        const set = form.setValue;
        form.setValue = (id, value) => {
          set(id, value);
          window.setTimeout(() => set(id, typeof value === 'string' ? `${value} ` : value), 5);
        };
      },
    },
  },
  'perf-key-rows': {
    section: 'perf',
    parts: ['key'],
    says: /^perf\.key\.rows /,
    fault: 'every row of the page is drawn again for a key typed in one',
    plant: {
      js: () => {
        const form = window.__control.getSnapshot().session.getState().form;
        const field = form.field;
        const set = form.setValue;
        let generation = 0;
        const made = new Map();
        form.setValue = (id, value) => {
          generation += 1;
          return set(id, value);
        };
        form.field = (id) => {
          const key = `${id}:${String(generation)}`;
          if (!made.has(key)) {
            const one = field(id);
            made.set(key, one === undefined ? one : { ...one });
          }

          return made.get(key);
        };
      },
    },
  },
  'perf-idle-timer': {
    section: 'perf',
    parts: ['idle'],
    says: /^perf\.idle\.timers /,
    fault: 'an interval is left running while the sheet is open',
    plant: { js: () => window.setInterval(() => undefined, 400) },
  },
  'perf-idle-commit': {
    section: 'perf',
    parts: ['idle'],
    says: /^perf\.idle\.commits /,
    fault: 'the page is told of a change every 400 ms, by a clock that is not the page\'s (a worker), so it draws again with no timer of its own',
    plant: {
      js: () => {
        const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(1), 400);'], { type: 'text/javascript' })));
        let flip = 0;
        worker.onmessage = () => window.__host.change('appearance.density', flip++ % 2 === 0 ? 'compact' : 'comfortable');
      },
    },
  },
  'perf-closed-node': {
    section: 'perf',
    parts: ['closed'],
    says: /^perf\.closed\.nodes /,
    fault: 'a node of the sheet is left in the document when it closes',
    plant: {
      js: () => {
        const close = window.__control.close;
        window.__control.close = () => {
          close();
          if (document.querySelector('[data-ghost]') === null) document.body.insertAdjacentHTML('beforeend', '<div data-settings-part="ghost" data-ghost></div>');
        };
      },
    },
  },
  'perf-closed-listener': {
    section: 'perf',
    parts: ['closed'],
    says: /^perf\.closed\.listeners /,
    fault: 'a listener on the window that the sheet adds when it opens stays when it closes',
    plant: {
      js: () => {
        const open = window.__control.open;
        window.__control.open = () => {
          window.addEventListener('blur', () => undefined);
          open();
        };
      },
    },
  },
  'perf-closed-timer': {
    section: 'perf',
    parts: ['closed'],
    says: /^perf\.closed\.timers /,
    fault: 'an interval that the sheet starts when it opens is not cleared when it closes',
    plant: {
      js: () => {
        const open = window.__control.open;
        window.__control.open = () => {
          window.setInterval(() => undefined, 400);
          open();
        };
      },
    },
  },
};
