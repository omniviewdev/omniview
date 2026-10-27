# Build Directory

The build directory is used to house all the build files and assets for your application. 

The structure is:

* bin - Output directory
* darwin - macOS specific files
* windows - Windows specific files

## Mac

The `darwin` directory holds files specific to Mac builds.
These may be customised and used as part of the build. To return these files to the default state, simply delete them
and
build with `wails build`.

The directory contains the following files:

- `Info.plist` - the main plist file used for Mac builds. It is used when building using `wails build`.
- `Info.dev.plist` - same as the main plist file but used when building using `wails dev`.

### Release packages and the developer CLI

Stable and nightly macOS DMGs contain `Omniview.app` only, plus the DMG's
installation presentation files. The application contains both universal
executables:

```text
Omniview.app/Contents/MacOS/Omniview
Omniview.app/Contents/MacOS/omniview-dev
```

Both executables include `arm64` and `x86_64` slices. The CLI uses the `server`
build tag and disables CGO; it does not require the GUI to be running to show
help or manage local workspace metadata. Release jobs build it against the
same stock module selection as the application, sign it before signing the
bundle, and include it in the notarized application.

The Homebrew casks link the CLI through the configured application directory,
not a hard-coded Homebrew prefix:

```ruby
binary "#{appdir}/Omniview.app/Contents/MacOS/omniview-dev", target: "omniview-dev"
```

Install or update one channel:

```sh
brew install --cask omniviewdev/tap/omniview
# For an existing installation:
brew update
brew upgrade --cask omniviewdev/tap/omniview
command -v omniview-dev
omniview-dev --help
```

Use `omniviewdev/tap/omniview-nightly` instead for nightly releases. The two
channels share `Omniview.app` and the `omniview-dev` command; do not install them
together. When switching channels, uninstall the old cask without `--zap`
before installing the new one. Homebrew owns the command link and removes it
on uninstall; no shell alias, copied executable, or manual `brew link` is needed.
An old app-only cask gains the link when upgraded to a CLI-bearing release.
If the current version is already installed with old cask metadata, use
`brew reinstall --cask omniviewdev/tap/omniview` after `brew update`.

`build/homebrew/update-cask.mjs` updates the tap's version/checksum and adds
the binary stanza idempotently. It preserves tap metadata and zap rules, and
rejects unexpected binary paths, archive URLs, or duplicate stanzas rather
than publishing an ambiguous cask. `HOMEBREW_TAP_TOKEN` is required for stable
and nightly cask publication. Missing credentials fail before creating a stable
release or deleting the previous nightly release.

Before either release is published, `homebrew-check.yml` uses native
Apple Silicon (`macos-15`) and Intel (`macos-15-intel`) runners to:

- Mount the actual release DMG and check executable modes, both architecture
  slices, and code signatures for the host and CLI.
- Install the candidate cask and invoke the linked CLI through Homebrew's
  native prefix with a custom application directory.
- Upgrade an app-only cask to the CLI-bearing cask, then upgrade the
  CLI-bearing cask again and check installed versions and link targets.
- Uninstall and require removal of both the application and CLI link.

The lifecycle checks use the real release archive, a temporary HTTP download
server, and a temporary local tap. They do not launch a GUI or access profiles.
PR checks run the publication updater tests and shell syntax checks.
Installed-version checks query `brew list --cask --versions` with the cask token;
tap-qualified names are reserved for selecting the candidate during installation
and upgrade. A failed lifecycle check blocks GitHub Release and tap publication,
even if the temporary CI installation itself succeeded.

Run lightweight checks locally:

```sh
node --test build/homebrew/update-cask.test.mjs
bash -n build/darwin/build-universal.sh
bash -n build/darwin/verify-release-package.sh
```

Given an actual signed release archive and a checkout of the published tap,
check the package and run Homebrew lifecycle checks on a disposable macOS CI
machine only:

```sh
DMG=/absolute/path/to/Omniview_VERSION_darwin_universal.dmg
TAP=/absolute/path/to/homebrew-tap
bash build/darwin/verify-release-package.sh "$DMG"
CI=true node build/homebrew/check-cask.mjs "$DMG" "$TAP/Casks/omniview.rb"
# Repeat with omniview-nightly.rb for the nightly candidate.
```

The lifecycle script refuses an existing `omniview-dev` command link, requires
`CI=true`, and cleans up its own cask and temporary tap. It still changes the
machine's Homebrew installation; do not run it on a personal workstation.


## Windows

The `windows` directory contains the manifest and rc files used when building with `wails build`.
These may be customised for your application. To return these files to the default state, simply delete them and
build with `wails build`.

- `icon.ico` - The icon used for the application. This is used when building using `wails build`. If you wish to
  use a different icon, simply replace this file with your own. If it is missing, a new `icon.ico` file
  will be created using the `appicon.png` file in the build directory.
- `installer/*` - The files used to create the Windows installer. These are used when building using `wails build`.
- `info.json` - Application details used for Windows builds. The data here will be used by the Windows installer,
  as well as the application itself (right click the exe -> properties -> details)
- `wails.exe.manifest` - The main application manifest file.