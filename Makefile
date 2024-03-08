.PHONY: docs

docs:
	cd docs && hugo server -D

dev:
	cd src && wails dev

lint-plugin:
	cd packages/plugin && golangci-lint run --fix

