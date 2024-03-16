.PHONY: build

build:
	rm -rf bin && rm -f kubernetes.tar.gz
	mkdir bin && go build -o bin/plugin ./pkg

update:
	go mod tidy
	
lint:
	golangci-lint run --fix

install: build
	mkdir -p ~/.omniview/plugins/kubernetes && \
		mkdir -p ~/.omniview/plugins/kubernetes/assets && \
		mkdir -p ~/.omniview/plugins/kubernetes/store && \
		cp plugin ~/.omniview/plugins/kubernetes/ && \
		cp plugin.yaml ~/.omniview/plugins/kubernetes/ && \
		rm plugin

package: build
	tar -czvf kubernetes.tar.gz plugin.yaml bin/plugin
	
