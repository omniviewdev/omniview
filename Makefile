.PHONY: docs

sync:
	go work sync

dev:
	pnpm install
	wails dev

build:
	wails build

lint: lint-core lint-plugin lint-kubernetes

lint-core:
	cd src && golangci-lint run --fix

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

lint-kubernetes:
	cd plugins/kubernetes && golangci-lint run --fix

install-kubernetes:
	cd plugins/kubernetes && go build
