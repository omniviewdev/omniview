.PHONY: build

prepare:
	pip install openapi2jsonschema

generate:
	cd generators && go run .
	go mod tidy
	golangci-lint run --fix ./pkg/plugin/resource/register_gen.go

build:
	rm -rf bin && rm -f kubernetes.tar.gz
	mkdir bin && go build -o bin/plugin ./pkg	
	cd ui && pnpm run build

build-ui:
	cd ui && pnpm run build

update:
	go mod tidy
	
lint:
	golangci-lint run --fix

install: build
	mkdir -p ~/.omniview/plugins/kubernetes/bin && \
		mkdir -p ~/.omniview/plugins/kubernetes/assets && \
		mkdir -p ~/.omniview/plugins/kubernetes/store && \
		cp bin/plugin ~/.omniview/plugins/kubernetes/bin/ && \
		cp plugin.yaml ~/.omniview/plugins/kubernetes/ && \
	  cp -r ui/dist/assets/* ~/.omniview/plugins/kubernetes/assets/
		rm bin/plugin

package: build
	tar -czvf kubernetes.tar.gz plugin.yaml bin/plugin

installui: 
	cd ui && pnpm run build
	mkdir -p ~/.omniview/plugins/kubernetes/assets
	cp -r ui/dist/assets/* ~/.omniview/plugins/kubernetes/assets/
	
storybook:
	cd ui && pnpm run storybook

storybook-build:
	cd ui && pnpm run build-storybook
