# Desktop update publishing

The release workflows publish signed feeds and payloads to the self-hosted update service. GitHub Releases and Homebrew remain separate distribution channels. Nightly releases activate automatically after validation; stable releases require approval in the update portal.
Release builds require `UPDATER_PUBLIC_KEYS` to be a non-empty JSON array of lowercase 64-hex Ed25519 public keys. Invalid trust configuration fails the build.

Run with Node.js and these environment variables:

- `UPDATER_SIGNING_KEYS`: JSON array of lowercase 64-hex Ed25519 seeds. Every configured key signs the same manifest bytes; the service requires its configured public-key set to match exactly.
- `UPDATE_SERVICE_URL`: update service API base URL, reachable from the runner.
- `UPDATE_SERVICE_PUBLISH_TOKEN`: bearer token for the publishing API.

```sh
node build/updater/publish-to-update-service.mjs \
  --channel stable --version 1.4.0 --dir dist \
  --git-sha "$GITHUB_SHA" \
  --run-url "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
```

Use `nightly` and a version of the form `0.0.0-nightly.YYYYMMDD.run_number.run_attempt` for nightly releases. The directory must contain exactly the four expected filenames for the version: `Omniview_<version>_darwin_universal.zip`, `Omniview_<version>_darwin_universal.dmg`, `Omniview_<version>_linux_amd64`, and `Omniview_<version>_windows_amd64.exe`. Other files in the directory are ignored.

The publisher streams each file to compute its SHA-256, signs a manifest binding the filenames, sizes, digests, and public URLs, and creates the release. It streams files to the returned presigned URLs, uploads the envelope, finalizes the release, and polls validation for up to 30 minutes. Create and finalize requests time out after 30 seconds; each upload attempt times out after 15 minutes. Uploads retry network and server errors three times, with 5, 15, and 45 second delays. A rejected release, create conflict, failed upload, or validation timeout fails the command. A successful `ready` stable release still needs portal approval.

The immutable envelope is stored at `releases/<channel>/<version>/manifest.json`, and activation copies its exact bytes to `channels/<channel>.json`. Payload URLs use `https://updates.omniview.dev/releases/<channel>/<version>/<filename>`. Keep signing seeds and the publish token secret. Rotate keys in the service and desktop trust configuration together with CI signing keys.

Run focused tests with `node --test build/updater/*.test.mjs`.
