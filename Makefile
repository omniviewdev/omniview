.PHONY: docs

docs:
	cd docs && hugo server -D

dev:
	cd src && wails dev



