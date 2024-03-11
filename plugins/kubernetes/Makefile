.PHONY: build

build:
	go build -o plugin ./pkg
	

install: build
	mkdir -p ~/.omniview/plugins/kubernetes && \
		mkdir -p ~/.omniview/plugins/kubernetes/assets && \
		mkdir -p ~/.omniview/plugins/kubernetes/store && \
		cp plugin ~/.omniview/plugins/kubernetes/ && \
		cp plugin.yaml ~/.omniview/plugins/kubernetes/ && \
		rm plugin
