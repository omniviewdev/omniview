
.PHONY: docs prepare sync packages dev dev-plugin runtime build

prepare:
	go install github.com/wailsapp/wails/v2/cmd/wails@v2.11.0

sync:
	go work sync

# Build all workspace packages (runtime, ui, providers, vite-plugin)
packages:
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

lint: lint-core lint-plugin lint-kubernetes

lint-core:
	cd src && golangci-lint run --fix

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

lint-kubernetes:
	cd plugins/kubernetes && golangci-lint run --fix

install-kubernetes:
	cd plugins/kubernetes && go build pkg/main.go
