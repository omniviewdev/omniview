#!/usr/bin/env bash
# The one smoke of the CI image, run inside it from a checkout of the repository:
#
#   docker run --rm --init -v "$PWD:/work:ro" -w /work <image> bash .github/ci/smoke.sh   (ci-image.yml, before the image is published)
#   - run: bash .github/ci/smoke.sh                                                       (a step of a container job, after: the way a consumer runs it)
#
# It proves what a consumer relies on: the toolchains answer, the native libraries are there, the manifest says what the repository pins (Playwright included: the version pnpm-lock.yaml
# resolves), and the Playwright of the image looks for its browsers where the image has them and launches Chromium and WebKit headless. It needs no `pnpm install`: a smoke that depends on the
# npm registry would fail the weekly publish on a registry hiccup (22 of the 274 non-gate job failures in the plan's sample were downloads). A failure prints `SMOKE-FAIL <rule>: ...`.
set -euo pipefail

fail() {
  echo "SMOKE-FAIL $1: $2" >&2
  exit 1
}
heading() { printf '\n== %s\n' "$1"; }

heading "the image"
[ "$(id -u)" = 0 ] || fail root "container jobs need root for workspace mounts, and this is $(id -un)"
jq -r '"built \(.built_at) from \(.source.sha[0:7]) (\(.source.run))", (.tools | to_entries[] | "  \(.key) \(.value)")' /opt/ci/manifest.json

heading "the toolchains answer"
node --version
pnpm --version
go version
task --version
golangci-lint --version
kind version
kubectl version --client
go version -m "$(command -v goimports)" | sed -n '1,3p'
scratch="$(mktemp -d)"
(cd "$scratch" && go mod init smoke >/dev/null 2>&1 && printf 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("go builds and runs") }\n' > main.go && go run .)
rm -rf "$scratch"

heading "the native libraries"
zstd --version
pkg-config --exists gtk4 webkitgtk-6.0 wayland-client || fail native-libraries "GTK4, WebKitGTK 6 or Wayland development files are missing"
pkg-config --modversion gtk4 webkitgtk-6.0 wayland-client
playwright install-deps --dry-run chromium webkit >/dev/null || fail browser-libraries "system libraries of Chromium or WebKit are missing (playwright install-deps --dry-run chromium webkit)"
echo "the system libraries of Chromium and WebKit are installed"

heading "the manifest against this checkout"
node scripts/ci/check-image.mjs check --manifest /opt/ci/manifest.json

heading "Playwright finds the baked browsers"
playwright --version
dry="$(playwright install --dry-run chromium webkit)"
echo "$dry"
locations="$(sed -n 's/^ *Install location: *//p' <<<"$dry")"
[ -n "$locations" ] || fail no-install-locations "playwright install --dry-run named no browser directory"
while read -r directory; do
  [ -d "$directory" ] || fail browser-directory-missing "Playwright looks for a browser in $directory, which the image does not have"
done <<<"$locations"
echo "every browser directory Playwright names exists"

heading "Chromium and WebKit launch headless"
NODE_PATH="$(npm root -g)" node - <<'LAUNCH'
const { chromium, webkit } = require('playwright');

(async () => {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>smoke</title><p id="x">ok</p>');
    const text = await page.locator('#x').textContent();
    if (text !== 'ok') throw new Error(`${name} rendered ${JSON.stringify(text)}`);
    console.log(`${name} ${browser.version()}: ${await page.evaluate(() => navigator.userAgent)}`);
    await browser.close();
  }
})().catch((error) => {
  console.error('SMOKE-FAIL launch:', error);
  process.exit(1);
});
LAUNCH
echo
echo "smoke ok"
