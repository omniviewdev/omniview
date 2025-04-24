
.PHONY: docs
prepare:
	go install github.com/wailsapp/wails/v2/cmd/wails@v2.8.0

sync:
	go work sync

dev:
	pnpm install
	wails dev -loglevel Error

runtime:
	cd packages/omniviewdev-runtime && pnpm run build

.PHONY: build
build:
	wails build

.PHONY: build-debug
build-debug:
	wails build -debug

lint: lint-core lint-plugin lint-kubernetes

lint-core:
	cd src && golangci-lint run --fix

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

lint-kubernetes:
	cd plugins/kubernetes && golangci-lint run --fix

install-kubernetes:
	cd plugins/kubernetes && go build pkg/main.go
