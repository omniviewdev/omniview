
.PHONY: docs
prepare:
	go install github.com/wailsapp/wails/v2/cmd/wails@v2.8.0

sync:
	go work sync

dev:
	pnpm install
	go run ../wails/v2/cmd/wails dev -loglevel Error

dev-plugin:
	wails dev -noreload -loglevel Error

runtime:
	cd packages/omniviewdev-runtime && pnpm run build

.PHONY: build
build:
	rm -f archive.zip
	go run ../wails/v2/cmd/wails build -clean

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
  --apple-id "jpare@turnout.email" \
  --password "***REMOVED***" \
  --team-id "696AD8J8ZT" \
  --wait

	# 4. Staple the ticket to the .app
	xcrun stapler staple build/bin/Omniview.app

	# 5. (Optional) Verify everything
	spctl --assess --type execute --verbose build/bin/Omniview.app

.PHONY: build-debug
build-debug:
	go run ../wails/v2/cmd/wails build -clean -debug

lint: lint-core lint-plugin lint-kubernetes

lint-core:
	cd src && golangci-lint run --fix

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

lint-kubernetes:
	cd plugins/kubernetes && golangci-lint run --fix

install-kubernetes:
	cd plugins/kubernetes && go build pkg/main.go
