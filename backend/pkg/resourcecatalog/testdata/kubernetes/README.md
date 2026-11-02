# Kubernetes OpenAPI v3 fixtures

Real Kubernetes OpenAPI v3 GroupVersion documents used by the catalog's
normalization, navigation, admission, editor and CEL tests and by the
`omniview.schema-policy.v1` measurement (spec §9).

| File | Source path |
| --- | --- |
| `api__v1.json.gz` | `/openapi/v3/api/v1` |
| `apis__apps__v1.json.gz` | `/openapi/v3/apis/apps/v1` |

- Fetched 2026-11-01, read-only, with
  `kubectl --context admin@homelab get --raw <path>` (kubectl 1.37.2), then
  `gzip -9 -n`. The documents are served byte-for-byte; nothing was edited.
- Server (`kubectl version -o yaml`, `serverVersion`):

```yaml
buildDate: "2026-10-27T12:01:06Z"
compiler: gc
emulationMajor: "1"
emulationMinor: "37"
gitCommit: c50e5395f1ae2d4a2c05f28fdcc38c0916cc1a32
gitTreeState: clean
gitVersion: v1.37.2
goVersion: go1.26.10
major: "1"
minCompatibilityMajor: "1"
minCompatibilityMinor: "36"
minor: "37"
platform: linux/amd64
```

The documents contain only the API schema. No cluster object bodies are
committed.
