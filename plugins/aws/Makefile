.PHONY: build

build:
	rm -rf bin && rm -f package.tar.gz
	mkdir bin && go build -o bin/plugin ./pkg

update:
	go mod tidy
	
lint:
	golangci-lint run --fix

package: build
	tar -czvf package.tar.gz plugin.yaml bin/plugin
	
