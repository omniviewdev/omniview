# Publish images and the write-up

Publishing is an external, visible action: do it only when the user asked for an issue/PR or hosted images. GitHub has no API (and `gh` no command) for issue attachment uploads, so images are hosted in git and linked.

## Orphan asset branch in the user's fork

Work in a temporary directory, never the working checkout, so no feature branch or index is touched:

```sh
FORK=<user>/omniview            # the user's fork, confirmed with: gh repo view "$FORK"
BRANCH=assets/<topic>-mocks
TMP="$(mktemp -d)" && cd "$TMP"
git init -q -b "$BRANCH"
mkdir screenshots prototype
cp ~/omniview/screenshots/<topic>/* screenshots/
cp ~/omniview/mocks/<topic>/{index.html,icons.js} prototype/
git add . && git commit -qm "assets: <topic> UI mocks"
git push "git@github.com:$FORK.git" "HEAD:refs/heads/$BRANCH"
SHA="$(git rev-parse HEAD)"
```

If the branch already exists, do not force-push over it; push a new branch or a follow-up commit. Old links stay valid because they are pinned.

## SHA-pinned URLs, each verified

```text
https://raw.githubusercontent.com/<fork-owner>/omniview/<SHA>/screenshots/<file>
```

Pin to the commit SHA, not the branch name, so the issue keeps showing the images that were reviewed. Check every URL before writing the body:

```sh
BASE="https://raw.githubusercontent.com/$FORK/$SHA"
for f in screenshots/*; do echo "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$f") $f"; done
```

Every line must be `200`. Remove the temporary directory afterwards.

## Issue body

```markdown
## Summary
One paragraph: the problem today and the proposed behavior.

## Behavior
| Input | Result |
| --- | --- |
| ⌘T / Ctrl+T | … |
| Shift+click | … |

## Details
Decisions stated explicitly (ordering, defaults, single-plugin path, platform labels, motion), so reviewers can push back.

## Palette / other surfaces
How the change appears in the command palette or other entry points, if any.

## Screenshots
Flow order, one image per step, one-line caption each:
**1. Current layout** — today, for comparison.
![](https://raw.githubusercontent.com/<fork-owner>/omniview/<SHA>/screenshots/00-current-layout-with-rail.png)
…
Animation: ![](…/flow-menu-animation-and-typeahead.gif)
Interactive prototype source: link to `prototype/index.html` on the asset branch (pinned).

## Implementation notes
Real file paths and components from grounding (e.g. `ui/layouts/core/main/Sidebar/index.tsx`, `ui/features/command-search/`), existing rules to reuse, plugin route/icon sources.

## Acceptance criteria
- [ ] One observable, testable behavior per box.
```

## Labels

Use only labels that already exist: `gh label list -R omniviewdev/omniview`. A UI proposal is typically `enhancement` + `frontend`. Create the issue from a body file:

```sh
gh issue create -R omniviewdev/omniview --title "<title>" --body-file body.md --label enhancement --label frontend
```

Open the created issue and confirm every image renders.
