---
"@omniviewdev/runtime": minor
---

Add `useWindowActions()` (`openInNewTab`, `openInNewWindow`, `openInSplit`) with `WindowActionsProvider` for opening host routes in page tabs and windows, and `navigateActivePage()`/`registerActivePageNavigator()` for navigation outside React. `Link` opens a new background tab on Ctrl/Cmd+click and middle-click inside a workspace window. Error `navigate` actions now navigate the active page tab instead of `window.location.hash`.
