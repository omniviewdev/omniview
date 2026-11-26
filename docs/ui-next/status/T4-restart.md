# Status: T4-restart (restart an ended terminal, issue #695 step 5)

- Agent: RestartEnded. Worktree `~/omniview/wt/t695-restart`, branch `feat/terminal-restart-ended` on `origin/main` `80bfe44c1` (after #787 title and rename, #784 marks, #786 failed pty, #777 New terminal here, #767 profiles, #725 `launch.env`). Epic #692. No push, no PR.
- 2026-11-26: started. Tests first (page only; no Go change planned: the host already lists `params` and `Session.shell.path`/`cwd`).

## Design (decisions, with the reason)

- **Restart is a NEW `CreateTerminal`** with a fresh id, in the SAME panel session (the tab keeps its place, its title and its pin). The registry swaps the feed as the take-back does (`replaceFeed`); the ended feed is closed once (an ended terminal is dismissed at the host, so the host forgets the old id).
- **The page chooses ids and never reuses one.** `localRestartTarget` takes an id source and asks again for the ended terminal's id and for the tab's id; an id source that only answers those refuses to open (no host meets the old id again). Ids are random UUIDs.
- **Which ends offer Restart: the producer states it** (`TerminalFeedHandle.restart`, defined only once the process is over for good, pure, no call). Offered: exited (any code), signaled, closed by request, window, shutdown or `detach-timeout`, a pty that failed (#786), and a terminal the host does not know any more (its shell is gone). Not offered: starting, running; a start that failed (the same request would fail the same way: the lane gives the cause); a lost connection (the shell may still run: a restart would start a second one; a reload may find it); a terminal another tab holds, or that it let go of (that is Take it back); an unsupported host version.
- **What is restarted from.** Shell: the path the host resolved (`session.shell.path`) plus the arguments that were asked for. Directory: the directory the host says the shell STARTED in (`session.cwd`), not the last tracked one: an ended shell cannot be asked, and #777 settled the same rule ("an ended or lost terminal falls back to the directory it started in"). Environment: what the page asked for (`launch.env`).
- **After a reload** the page has lost what it asked for. It attaches it to the terminal when it makes it (`params.tab`, `params.launch` = `{command, env}`: the host lists `params` back with the terminal, and nothing else lists them). A restarted terminal lists `params.tab` = the tab it replaced, so the reload gives the tab its new terminal. Two listed terminals of one tab (the ended one a restart replaced may still be listed if its dismiss was lost): the one that runs, else the one made last. Parsing is strict: a malformed `launch` or a non-text env value is dropped.
- **A refused restart says why and falls back as #777 does.** A removed start directory: the host answers `INVALID_REQUEST`, the terminal is made again without it (`homeIfMissing`), note `home-for-removed-directory` ("The directory it started in is gone.", this also fixes the #777 wording, which said the directory was not known). A shell that is gone: the host's resolution order starts the next shell and says `shell.requested`; the feed says `shell-replaced` ("The shell it ran before is not available."). Anything else is the failed start of any terminal, with the host's words and `tried[]`.
- **The transcript stays above the new shell.** The screen that shows the ended feed goes on with the new one (`screen.continueWith`): the same emulator, so scrollback, find and selection continue; a separator (soft terminal reset, leave the alternate screen, a muted `[Restarted]` line) follows the exit line. The size is told to the new feed at once (it starts the terminal). The body keeps its screen for a feed the registry says continues another (`restartedFrom`), and makes a new one for any other swap (take-back).
- **Keys.** The lane has a Restart button; Enter in the screen of a session that takes no input asks the registry (plain Enter only; while the session takes input Enter is the shell's).
- **Two presses.** One new terminal: the registry's swap is synchronous, so the second press finds a terminal that starts, and a press inside the open of the first is refused (`restarting`).

## Shas

(see "Commits" at the end)

## Not verified / out of scope

- Probe and seam scenarios are step 6.
