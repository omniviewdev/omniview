# check=skip=InvalidDefaultArgInFrom
# The Linux CI image: ghcr.io/omniviewdev/omniview-ci, built and published by .github/workflows/ci-image.yml. It holds what the container jobs would otherwise install on every run: the native
# build libraries (GTK4, WebKitGTK 6, Wayland), the WebKit and Chromium system libraries, the Playwright browsers of the version pnpm-lock.yaml resolves, Node, pnpm, Go, Task, goimports,
# golangci-lint, kind and kubectl. /opt/ci/manifest.json lists what the image holds, observed from the tools themselves.
#
# Versions have one home each:
#   Node, pnpm, Playwright   the repository (.tool-versions, package.json `packageManager`, pnpm-lock.yaml). They are build arguments WITHOUT a default: a second copy here would be a copy
#                            that nothing ties to the repository. `node scripts/ci/check-image.mjs inputs --format docker-args` prints them.
#   the tools below          this file. scripts/ci/check-image.mjs checks the ones another workflow still pins (kind, kubectl) and the Go series against go.mod.
# Every binary is pinned by version and verified by sha256. Nothing here is `latest`.
#
# The tag is immutable (ubuntu24-<yyyymmdd>-<git sha>) and consumers pin the digest recorded in .github/ci/image.lock.
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim AS node

FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG NODE_VERSION
ARG PNPM_VERSION
ARG PLAYWRIGHT_VERSION

ARG GO_VERSION=1.27.3
ARG GO_SHA256=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40
ARG TASK_VERSION=v3.54.0
ARG TASK_SHA256=680859dbb4d881a9c72d4d9a8f510825450849af8567deacd7302c01124416fb
ARG GOLANGCI_LINT_VERSION=v2.15.0
ARG GOLANGCI_LINT_SHA256=9b7fe6a6bf6334b98decf8d86b11415ea7889afdabdd1959fdce23af2a9ebcea
ARG GOIMPORTS_VERSION=v0.53.0
ARG KIND_VERSION=v0.30.0
ARG KIND_SHA256=517ab7fc89ddeed5fa65abf71530d90648d9638ef0c4cde22c2c11f8097b8889
ARG KUBECTL_VERSION=v1.35.0
ARG KUBECTL_SHA256=a2e984a18a0c063279d692533031c1eff93a262afcc0afdc517375432d060989

# The browsers live outside any home directory: a container job's HOME is not the image's. Go is on PATH; GOROOT is not set, so a Go that actions/setup-go adds in front keeps its own.
ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/usr/local/go/bin:${PATH}

# Node is needed by GitHub JavaScript actions and Playwright's dependency installer.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN : "${NODE_VERSION:?pass the inputs of the image: node scripts/ci/check-image.mjs inputs --format docker-args}" \
    && : "${PNPM_VERSION:?pass the inputs of the image: node scripts/ci/check-image.mjs inputs --format docker-args}" \
    && : "${PLAYWRIGHT_VERSION:?pass the inputs of the image: node scripts/ci/check-image.mjs inputs --format docker-args}" \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libgtk-4-dev libwebkitgtk-6.0-dev libwayland-dev \
        build-essential pkg-config \
        git curl ca-certificates unzip zip zstd sudo jq dbus-x11 xvfb \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

RUN curl -fsSL --retry 3 --retry-delay 2 -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum --check --strict \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz

RUN set -eux; \
    cd /tmp; \
    curl -fsSL --retry 3 --retry-delay 2 -o task.tar.gz "https://github.com/go-task/task/releases/download/${TASK_VERSION}/task_linux_amd64.tar.gz"; \
    echo "${TASK_SHA256}  task.tar.gz" | sha256sum --check --strict; \
    tar -xzf task.tar.gz task; \
    install -m 0755 task /usr/local/bin/task; \
    curl -fsSL --retry 3 --retry-delay 2 -o golangci-lint.tar.gz "https://github.com/golangci/golangci-lint/releases/download/${GOLANGCI_LINT_VERSION}/golangci-lint-${GOLANGCI_LINT_VERSION#v}-linux-amd64.tar.gz"; \
    echo "${GOLANGCI_LINT_SHA256}  golangci-lint.tar.gz" | sha256sum --check --strict; \
    tar -xzf golangci-lint.tar.gz --strip-components=1 "golangci-lint-${GOLANGCI_LINT_VERSION#v}-linux-amd64/golangci-lint"; \
    install -m 0755 golangci-lint /usr/local/bin/golangci-lint; \
    curl -fsSL --retry 3 --retry-delay 2 -o kind "https://github.com/kubernetes-sigs/kind/releases/download/${KIND_VERSION}/kind-linux-amd64"; \
    echo "${KIND_SHA256}  kind" | sha256sum --check --strict; \
    install -m 0755 kind /usr/local/bin/kind; \
    curl -fsSL --retry 3 --retry-delay 2 -o kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"; \
    echo "${KUBECTL_SHA256}  kubectl" | sha256sum --check --strict; \
    install -m 0755 kubectl /usr/local/bin/kubectl; \
    rm -rf /tmp/*

# goimports has no release binary. Go verifies the module against its checksum database; the build caches are removed again.
RUN GOBIN=/usr/local/bin GOTOOLCHAIN=local go install "golang.org/x/tools/cmd/goimports@${GOIMPORTS_VERSION}" \
    && rm -rf /root/go /root/.cache

# pnpm and Playwright from npm at the pinned versions, the system libraries of Chromium and WebKit, then the browsers of exactly this Playwright.
RUN npm install --global "pnpm@${PNPM_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
    && playwright install-deps chromium webkit \
    && playwright install chromium webkit \
    && chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /root/.npm /root/.cache /tmp/*

# Last, because these change on every build: when it was built, from which commit and run, and from which inputs. The manifest is what the tools report about themselves, and the build
# fails when a tool is not the version that was asked for. scripts/ci/check-image.mjs reads it.
ARG DOCKERFILE_SHA256
ARG INPUTS_SHA256
ARG BUILT_AT
ARG SOURCE_SHA
ARG SOURCE_RUN
RUN <<'MANIFEST'
set -euo pipefail
for name in DOCKERFILE_SHA256 INPUTS_SHA256 BUILT_AT SOURCE_SHA SOURCE_RUN; do
  [ -n "${!name:-}" ] || { echo "build argument $name is empty: build through .github/workflows/ci-image.yml" >&2; exit 1; }
done
semver() { grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1; }
node_v=$(node --version); node_v=${node_v#v}
pnpm_v=$(pnpm --version)
playwright_v=$(playwright --version | semver)
go_v=$(go env GOVERSION); go_v=${go_v#go}
task_v=v$(task --version | semver)
golangci_v=v$(golangci-lint --version | semver)
goimports_v=$(go version -m /usr/local/bin/goimports | awk '$1 == "mod" && $2 == "golang.org/x/tools" { print $3 }')
kind_v=$(kind version | grep -Eo 'v[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
kubectl_v=$(kubectl version --client -o json | jq -r .clientVersion.gitVersion)
for pair in "node $node_v $NODE_VERSION" "pnpm $pnpm_v $PNPM_VERSION" "playwright $playwright_v $PLAYWRIGHT_VERSION" "go $go_v $GO_VERSION" "task $task_v $TASK_VERSION" \
  "golangci-lint $golangci_v $GOLANGCI_LINT_VERSION" "goimports $goimports_v $GOIMPORTS_VERSION" "kind $kind_v $KIND_VERSION" "kubectl $kubectl_v $KUBECTL_VERSION"; do
  set -- $pair
  [ "$2" = "$3" ] || { echo "$1 is $2 in the image and $3 was asked for" >&2; exit 1; }
done
core=$(find "$(npm root -g)" -path '*/playwright-core/browsers.json' | head -n1)
[ -n "$core" ] || { echo "playwright-core/browsers.json is not under $(npm root -g)" >&2; exit 1; }
browsers=$(ls -1 "$PLAYWRIGHT_BROWSERS_PATH" | jq -R . | jq -s --arg root "$PLAYWRIGHT_BROWSERS_PATH" --slurpfile core "$core" '
  ($core[0].browsers | map({key: .name, value: .browserVersion}) | from_entries) as $versions
  | [.[] | capture("^(?<dir>[a-z_]+)-(?<revision>[0-9]+)$") | .name = (.dir | gsub("_"; "-"))]
  | {path: $root} + (map({key: .name, value: {revision: .revision, version: ($versions[.name] // null)}}) | from_entries)')
mkdir -p /opt/ci
. /etc/os-release
jq -n \
  --arg built_at "$BUILT_AT" --arg sha "$SOURCE_SHA" --arg run "$SOURCE_RUN" --arg inputs "$INPUTS_SHA256" --arg dockerfile "$DOCKERFILE_SHA256" \
  --arg os_id "$ID" --arg os_version "$VERSION_ID" \
  --arg node "$node_v" --arg pnpm "$pnpm_v" --arg playwright "$playwright_v" --arg go "$go_v" --arg task "$task_v" \
  --arg goimports "$goimports_v" --arg golangci "$golangci_v" --arg kind "$kind_v" --arg kubectl "$kubectl_v" \
  --argjson browsers "$browsers" '{
    schema: 1,
    image: "ghcr.io/omniviewdev/omniview-ci",
    built_at: $built_at,
    source: {repository: "omniviewdev/omniview", sha: $sha, run: $run},
    inputs_sha256: $inputs,
    dockerfile_sha256: $dockerfile,
    os: {id: $os_id, version: $os_version},
    tools: {node: $node, pnpm: $pnpm, playwright: $playwright, go: $go, task: $task, goimports: $goimports, "golangci-lint": $golangci, kind: $kind, kubectl: $kubectl},
    browsers: $browsers
  }' > /opt/ci/manifest.json
chmod 0644 /opt/ci/manifest.json
cat /opt/ci/manifest.json
MANIFEST

LABEL org.opencontainers.image.source="https://github.com/omniviewdev/omniview" \
      org.opencontainers.image.description="Omniview Linux CI image: native libraries, Go, Node, pnpm, Playwright browsers, Task, kind, kubectl. /opt/ci/manifest.json lists what it holds." \
      org.opencontainers.image.revision="${SOURCE_SHA}" \
      org.opencontainers.image.created="${BUILT_AT}"

# GitHub container jobs need root for workspace mounts and tool-cache setup.
USER root
