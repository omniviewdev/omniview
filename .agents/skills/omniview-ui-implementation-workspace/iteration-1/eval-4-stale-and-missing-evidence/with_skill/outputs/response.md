**This is not acceptable, and completion must remain blocked.** Yesterday’s approval applies to snapshot `abc`, not today’s changed implementation.

### What invalidates the approval

Both changes independently invalidate it:

- **CSS changed by a child agent through a shell command.** Relevant changes invalidate approval regardless of which agent or write mechanism made them.
- **The `base-ui` version changed in `package.json`.** Dependency changes require a fresh snapshot and review against the actual installed version and its supported APIs.

Any relevant source, CSS, dependency, policy, or agent change invalidates prior approval. The parent must not copy yesterday’s receipt or self-attest to a new approval. Only the independent auditor may submit approval through the installed audit gate, when available.

### Why the proposed evidence and ticket are insufficient

- A **DOM dump named `screenshot.png` is not a screenshot** and cannot establish visual acceptance. It must be identified honestly as DOM evidence; renaming it does not demonstrate rendered pixels.
- **Browser unavailability is a verification limitation, not a waiver.** It prevents a visual pass unless valid matched current rendering evidence is otherwise available.
- A **library-gap ticket does not authorize the altered field layout**. The shared capability must be fixed, or an explicit, narrowly scoped exception must identify an owner, tracking reference, and removal condition. A migration does not authorize a redesign.

### How the independent audit should report status

The auditor should review a **fresh snapshot**, with the changed-file list, actual installed package versions, preserved approved baseline, parity contract, and available evidence. It must issue four separate verdicts:

| Verdict | Required treatment |
|---|---|
| Library compliance | Review the new installed API, CSS changes, and actual composition. Mark **failed** for confirmed blocking violations; **unverified** where required evidence is missing. |
| Composition parity | Compare the altered layout against the approved contract. The ticket alone cannot justify a pass; confirmed unapproved drift is **failed**. |
| Information/interaction preservation | Review source and available evidence, explicitly listing any interactions or states that cannot be exercised. Those required checks remain **unverified**. |
| Visual acceptance | **Unverified** without valid matched current pixel evidence. The DOM dump cannot support a pass. |

The report should distinguish source-confirmed findings from observations and inferences. Any failed or unverified required verdict blocks completion.

### What can still be done now

Without claiming runtime checks were performed:

1. Preserve yesterday’s baseline and approval as historical evidence, without reusing them as current approval.
2. Establish the current checkout, changed files, dependency state, and exact installed `base-ui` version.
3. Review the CSS and owning consumer against the approved appearance, field sizing, responsive behavior, information, and interaction contract.
4. Check installed component documentation and supported composition APIs—not a newer checkout’s stories.
5. Make the gap record actionable: owning package/component, APIs evaluated and why insufficient, affected consumers, baseline/reproduction evidence, requested capability, and acceptance criteria. Resolve it through a shared fix or obtain the explicit exception.
6. Request the independent auditor for the current snapshot and complete reachable source/documentation checks.
7. Record the blocked runtime checks for later: matched integrated screenshots, real controls and CSS, keyboard/focus behavior, relevant states, and narrow layouts using the established instance-verification workflow.

The honest outcome now is **source review may proceed; visual acceptance and completion remain blocked**. If no runtime audit gate is loaded, explicitly state that enforcement is advisory—do not imply automatic enforcement or approval.