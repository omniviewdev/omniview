FROM node:26.13.0-bookworm-slim AS node

FROM ubuntu:24.04

ARG PLAYWRIGHT_VERSION=1.64.1

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Node is needed by GitHub JavaScript actions and Playwright's dependency installer.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        libgtk-4-dev libwebkitgtk-6.0-dev libwayland-dev \
        build-essential pkg-config \
        git curl ca-certificates unzip zip zstd sudo jq dbus-x11 xvfb \
    && npm install --global "playwright@${PLAYWRIGHT_VERSION}" \
    && playwright install-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# GitHub container jobs need root for workspace mounts and tool-cache setup.
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
