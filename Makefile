.PHONY: docs

docs:
	cd docs && hugo server -D

dev:
	cd src && wails dev

lint:
	cd src && golangci-lint run --fix

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

