# UI extension consent for one profile

The host reads **`<selected state root>/ui-extensions/policy.v1.json`**. This is the resolved application profile, not a plugin directory, repository, or global fallback. The host creates the private directory, never a grant. No policy means no extension authority. Ordinary plugin pages remain independent.

The operator of the OS account controls this file. The renderer has one read-only method, `extensionpolicy.Service.Read()`. Do not register `Store`, export a writer through Wails, or use plugin manifests, local storage, settings patches or events as a substitute for consent. OS file permissions do not sandbox native programs running as the operator.

## Make a decision

Before granting, inspect the installed **owner and contributor**, their verified artifact pins, the qualified point and offer, placement, and full protocol. Review the purpose, requested fields and conditions, whether contributor code runs or renders, and the separate read ID/row schema if requested. A friendly label, registry version, npm locator, feature URL or successful build proves none of these. Do not grant an unknown package on the promise that it may be installed later.

The UTF-8 JSON document has two required members: `schemaVersion` (integer `1`) and `grants` (array). The following is a complete policy that grants nothing:

```json
{"schemaVersion":1,"grants":[]}
```

| Member | Meaning |
| --- | --- |
| `grants[].point`, `grants[].offer` | Exact `installed-owner/local-point` and `installed-contributor/local-offer`. One row per ordered pair, no wildcards. |
| `grants[].ownerPin`, `grants[].contributorPin` | The corresponding **installed verified package** identities, each `sha256:` followed by 64 lowercase hex digits. Never a version or an individual asset hash. |
| `grants[].contract` | 64 lowercase hex digits pinning the complete compiled point contract, including placement. |
| `grants[].fields` | Required array of distinct scalar field names the operator allows. `[]` permits no fields; it is not permission to skip any required condition. An absent grant is never an empty grant. |
| `grants[].read` | Optional, independent consent for the exact read ID **and** full row contract, as 64 lowercase hex digits. Omit for no read. This does not grant backend credentials or a root. |
| `disabledOffers` | Optional array of distinct qualified offers to deny at every point, including later targets. |
| `disabledBindings` | Optional array of distinct `{"point":…, "offer":…}` pairs to deny. Either disable beats an allow. |
| `disabled` | Optional profile-wide boolean kill switch. `true` denies all extension work. Defaults to `false`; grants are still required. |
| `previous` | Optional 64 lowercase hex digits: SHA-256 of **all exact bytes** of the prior private file reviewed by the operator, including whitespace/newline. The native writer checks this for stale edits. A file's own claim is not proof of continuity. |

The host admission component `prepareExtensionSource` derives the point's `contract` and optional `read` before consent. To independently reproduce them, sort map entries by ASCII field name into `[name,type]` pairs. Sort optional keys in ASCII order (absent = `[]`). A read tuple is `[versionedReadId, sortedRowPairs]`. Hash UTF-8 bytes of compact `JSON.stringify` of this array, with no newline:

```text
[placement, protocolId, kind, sortedFieldPairs, sortedOptionalKeys, sectionResultPairsOrNull, readTupleOrNull]
```

The separate `read` fingerprint hashes UTF-8 `JSON.stringify(readTuple)` alone. Published protocols use their SDK-defined fields and result schema, not an empty inline substitute. [The author contract](../../docs/ui-next/slices/extension-api-v1.md#identity-and-compatibility) defines the IDs and compiled definitions. Bindings still require installed Running sources, exact compatibility, requested and granted fields, and live placement authority. Policy does not load code or create a binding.

The file limit is 1 MiB. Each of the three row/disable lists is limited to 1,024 entries. A grant has at most 64 fields. IDs are case-sensitive safe ASCII segments, 1–128 bytes. Unknown or duplicate JSON members, duplicate rows or fields, nulls, invalid pins, invalid IDs, trailing data and unsupported versions invalidate the **whole** file. In contrast, a syntactically valid row with a stale package pin or absent target cannot authorize that edge and does not invalidate a different valid row.

## Apply, revoke and recover

1. Use the profile's existing private `ui-extensions` directory on a supported local filesystem. On Unix it must belong to the current user with no group/other access (normally `0700`). Its profile parent must not be group/other writable. On Windows use the host-created owner-only directory and leave its DACL protected. No symlinks, reparse points, shared files, hard links or network shares.
2. Prepare a **complete new file** in that directory, private at creation. Serialize operator updates. For a native operator update, compute `previous` from the exact file reviewed (for example, `shasum -a 256 policy.v1.json` on macOS). If that file has changed, review the new state before applying. A direct external replacement **always** starts new lifetimes for all rows, even with a matching `previous`: the watcher may have missed an intervening revoke.
3. Flush and close the new file, atomically replace the old name, and sync the directory where supported. On Unix a temporary sibling created with `mktemp` under `umask 077`, flushed and `mv`-renamed **in the same directory**, provides the private publication boundary. On Windows use an owner-private sibling and same-volume replace with write-through. Native operator code can call `Store.Replace(bytes)` for validation, a stale-predecessor check, synced write and atomic replacement. Do **not** edit live bytes in place or chmod a public file into service. No plugin or renderer API performs this operation.
4. Remove a row to revoke it; remove `read` to withdraw only that read decision. Add a targeted disable or set `disabled:true` for emergency recovery. An unlink, corrupt file, lost watch, insecure path, or unreadable file withdraws all consent. Replace with a new private snapshot to repair; there is no last-known-good allowance. Restart with `OMNIVIEW_DISABLE_UI_EXTENSIONS=1` to bypass all policy activation, including a corrupted profile, without any renderer action. Remove the override and restart only after reviewing current policy.

Each application window subscribes **before** reading. Reconnect requires a new subscription and read. On `ui-extensions:policy-invalidated`, fence affected work synchronously and reread. The notification contains revisions and optionally an affected-pair list, never authority. A missing/mismatched revision, missing `affected`, unknown policy or ambiguous reconnect requires a full fence.

Only a serialized native `Store.Replace` with a matching `previous` can preserve unchanged rows. It identifies the object actually displaced by the atomic replacement, checks its private bytes, and verifies the identity and bytes of the new object. An ambiguous race fences all rows. For a proven adjacent native change, reordering has no effect. A field-only edit carries `fields`: the exact names added or removed, not their values. Work whose verified request contains none of those names may survive **only** if the native reread confirms that exact revision and issuance. Revoke/regrant, a changed pin or contract, a relevant disable, restart or failed observation invalidates the prior authority. Neither a file nor a notification can issue a continuity token.

A proven change to only the separate read decision carries `readOnly: true` instead of `fields`. Every window immediately strips the read and unmounts any Body that could retain prior rows. The scalar tab can remain selected. Only the matching native reread can confirm that continuity or authorize the replacement read. A combined read-and-field edit or an external replacement is not a read-only change.
