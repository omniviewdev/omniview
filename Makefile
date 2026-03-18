
.PHONY: docs prepare sync packages dev dev-plugin runtime build
.PHONY: check go-build go-vet go-test go-lint bindings bindings-check
.PHONY: ui-install ui-build ui-lint ui-typecheck fmt fmt-check

# ──────────────────────────────────────────────
# CI / Verification targets
# ──────────────────────────────────────────────

# Run all checks in sequence, fail fast on first error.
# Note: dist/.gitkeep satisfies the go:embed directive so Go checks work without a frontend build.
check: go-build go-vet go-test go-lint fmt-check bindings-check ui-install ui-build ui-lint ui-typecheck

# Go checks
go-build:
	GOWORK=off go build ./...

go-vet:
	GOWORK=off go vet ./...

go-test:
	GOWORK=off go test ./...

go-lint:
	@if command -v golangci-lint >/dev/null 2>&1; then \
		GOWORK=off golangci-lint run; \
	else \
		echo "golangci-lint not installed, skipping"; \
	fi

# Go formatting
fmt:
	goimports -w .
	gofmt -w .

fmt-check:
	@UNFORMATTED=$$(gofmt -l .); \
	if [ -n "$$UNFORMATTED" ]; then \
		echo "The following Go files are not formatted:"; \
		echo "$$UNFORMATTED"; \
		exit 1; \
	fi

# Wails bindings
bindings:
	GOWORK=off wails generate module

bindings-check:
	@TMPDIR=$$(mktemp -d); \
	cp -R packages/omniviewdev-runtime/src/wailsjs "$$TMPDIR/wailsjs-before"; \
	GOWORK=off wails generate module; \
	if ! diff -r packages/omniviewdev-runtime/src/wailsjs "$$TMPDIR/wailsjs-before" >/dev/null 2>&1; then \
		echo "Wails bindings are stale. Run 'make bindings' and commit the result."; \
		rm -rf "$$TMPDIR"; \
		exit 1; \
	fi; \
	rm -rf "$$TMPDIR"

# Frontend checks
ui-install:
	pnpm install --frozen-lockfile

ui-build:
	$(MAKE) packages
	pnpm build

ui-lint:
	ESLINT_USE_FLAT_CONFIG=false pnpm lint

ui-typecheck:
	pnpm exec tsc -p tsconfig.app.json --noEmit

# ──────────────────────────────────────────────
# Development targets
# ──────────────────────────────────────────────

prepare:
	go install github.com/wailsapp/wails/v2/cmd/wails@v2.11.0

sync:
	go work sync

# Build all workspace packages in dependency order
packages:
	pnpm --filter @omniviewdev/providers run build
	pnpm --filter @omniviewdev/vite-plugin run build
	pnpm --filter @omniviewdev/ui run build
	pnpm --filter @omniviewdev/runtime run build

dev:
	pnpm install
	$(MAKE) packages
	wails dev -loglevel Error

dev-plugin:
	wails dev -noreload -loglevel Error

runtime:
	cd packages/omniviewdev-runtime && pnpm run build

build:
	pnpm install
	$(MAKE) packages
	rm -f archive.zip
	wails build -clean

.PHONY: sign
sign:
	# 1. Sign the .app
	codesign --deep --force \
		--options runtime \
		--entitlements build/darwin/entitlements.plist \
		--sign "Developer ID Application: Joshua Pare (696AD8J8ZT)" \
		build/bin/Omniview.app

	# 2. Zip the .app
	ditto -c -k --keepParent --rsrc build/bin/Omniview.app archive.zip

	# 3. Submit for notarization
	xcrun notarytool submit archive.zip \
  --apple-id "$(NOTARIZE_APPLE_ID)" \
  --password "$(NOTARIZE_PASSWORD)" \
  --team-id "$(NOTARIZE_TEAM_ID)" \
  --wait

	# 4. Staple the ticket to the .app
	xcrun stapler staple build/bin/Omniview.app

	# 5. (Optional) Verify everything
	spctl --assess --type execute --verbose build/bin/Omniview.app

.PHONY: build-debug
build-debug:
	wails build -clean -debug
