Linux Secret Service prerequisite proof (HR02)

This standalone module uses real org.freedesktop.secrets calls through
maintained github.com/godbus/dbus/v5 v5.1.0 (BSD-2-Clause). It adds no host
API or dependency. All keys/passwords are synthetic random values. Keys
never enter process arguments, environment variables, files, or output.
The daemon's synthetic unlock password goes through stdin. Output is JSON.
The Secret Service "plain" session algorithm means local authenticated
D-Bus transport, NOT encrypted transport or a claim about daemon disk
implementation. No plaintext fallback exists. SQLite below contains only
random synthetic test data; its encryption is explicitly NOT claimed.

Linux/Ubuntu packages:
  sudo apt-get update
  sudo apt-get install -y dbus gnome-keyring libglib2.0-bin coreutils
Go 1.26.0+ required. From this module:
  GOWORK=off go mod download
  sh smoke.sh

smoke.sh builds a temporary binary, creates fresh owner-only HOME/XDG
paths, and starts an isolated dbus-run-session. It runs an owned foreground
gnome-keyring daemon. A random password travels through stdin, not argv.
It never touches the user's daemon or bus. Daemon startup polls at most
five seconds; session execution is bounded by timeout 40s. Every exit
removes owned files and stops the owned process. Never run inner directly.

Individual commands, ONLY inside an owned disposable session/environment:
  HISTORY_PROOF_OWNED_SESSION=1 /absolute/path/to/proof available
  dbus-run-session -- /absolute/path/to/proof unavailable
The first needs an unlocked default collection; it creates, reads, replaces,
deletes a unique owned item, confirms deletion, locks the disposable
collection, and confirms a write is denied. It never unlocks user state.
An absent or locked collection is a hard error, never fallback.
The wrapper then stops its daemon and runs unavailable on the SAME bus,
proving stale service disappearance is denied without activation/fallback.
A separate fresh bus covers a service that was never present. These
unavailable scenarios succeed only when NameHasOwner returns false.
D-Bus errors and calls are bounded by a 25-second context.

Filesystem assertions use fresh 0700 directories, process umask 0077,
and real modernc SQLite WAL files. DB/WAL/SHM must have effective-UID
ownership and mode 0600 while open. Preexisting symlinks at each name
must fail preflight. This is NOT a race-proof VFS or os.Root proof.
Private parent ownership excludes other UIDs; hostile same-UID processes,
root, hardlink attacks, inherited ACLs, power loss, and SQLite encryption
are not proven. Production must separately resolve these requirements.

Runtime observed 2026-10-28: Docker Desktop Linux ARM64 container on
Darwin ARM64. Image golang:1.26-bookworm, manifest digest
sha256:23ce71337b726608afb1bc00986e630a05034a87a87ea1fc2cd1ae5cf33387eb.
Actual Linux ARM64 execution, not an AMD64 emulation/performance claim.
Native Ubuntu CI remains for parent integration; no claim it ran here.

Completed verification: GOWORK=off go vet ./... passed in that container.
sh smoke.sh passed the key lifecycle/locked-write/private-file scenario,
then stale-daemon absence and fresh-bus absence. Each emitted status=passed.
No user credentials, production cloud calls, or user's session were used.

Exact Go dependencies are pinned in go.mod/go.sum. Primary licenses:
  github.com/godbus/dbus/v5 v5.1.0: BSD-2-Clause
  modernc.org/sqlite v1.61.0: BSD-3-Clause; SQLite public domain;
    bundled third-party notices: LICENSE-3RD-PARTY.md, LICENSE-SQLITE_VEC
  github.com/dustin/go-humanize v1.1.0: MIT
  github.com/google/uuid v1.6.0: BSD-3-Clause
  github.com/mattn/go-isatty v0.0.24: MIT
  github.com/ncruces/go-strftime v1.1.0: MIT
  github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec: BSD-3-Clause
  golang.org/x/sys v0.49.0: BSD-3-Clause
  modernc.org/libc v1.79.0: BSD-3-Clause plus LICENSE-3RD-PARTY.md
  modernc.org/mathutil v1.7.1: BSD-3-Clause
  modernc.org/memory v1.12.1: BSD-3-Clause plus LICENSE-GO/LICENSE-MMAP-GO
Distribution must preserve upstream notices, not just this inventory.
Debian/Ubuntu runner packages retain their distro copyright notices:
D-Bus (AFL-2.1 OR GPL-2.0-or-later), GNOME Keyring (GPL-2.0-or-later,
with library-specific exceptions), GLib (LGPL-2.1-or-later), coreutils
(GPL-3.0-or-later). They are runtime tools, not vendored dependencies.
