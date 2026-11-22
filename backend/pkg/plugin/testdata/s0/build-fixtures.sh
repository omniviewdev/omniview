#!/bin/sh
# SPIKE S0 (SDK0-S0-dual-read.md): build the plugin fixtures of the dual-read test from the SDK's own
# examples/resource-plugin, once per SDK generation, each under its own plugin id so that ONE host
# process can hold all of them at once.
#
#   build-fixtures.sh OUT_DIR SDK_V0200_DIR SDK_V0210_DIR SDK_NEW_DIR
#
#   notes-old020  built on SDK v0.20.0 (what the shipped Kubernetes plugin v0.21.2 is built on): protocol 1, wire 3
#   notes-old021  built on SDK v0.21.0 (ae56fb0, the tag the host pin moves to next):           protocol 1, wire 3
#   notes-new     built on the modified SDK (wip/spike/s0-dual-read): protocol 2, wire 4, required
#                 ResourceType.environment
#
# The example's plugin id is a const, so each build works on a copy with the id changed. The copy
# is a throwaway module (a replace to the SDK directory), never the SDK's tree.
set -eu
out=$1; v0200=$2; v0210=$3; new=$4
mkdir -p "$out"
export GOWORK=off GOTOOLCHAIN=local GOFLAGS=-mod=mod CGO_ENABLED=${CGO_ENABLED:-1}

build() { # name sdkdir
	name=$1; sdk=$2
	work=$(mktemp -d)
	cp "$sdk/examples/resource-plugin/main.go" "$sdk/examples/resource-plugin/provider.go" "$work/"
	cp -R "$sdk/examples/resource-plugin/data" "$work/data"
	# the id is a const in the SDK example; the copy gets this fixture's id
	sed -i.bak "s/pluginID         = \"notes\"/pluginID         = \"$name\"/" "$work/provider.go"
	rm -f "$work/provider.go.bak"
	grep -q "\"$name\"" "$work/provider.go"
	cat >"$work/go.mod" <<EOF
module s0fixture
go 1.27.0
require github.com/omniviewdev/plugin-sdk v0.0.0
replace github.com/omniviewdev/plugin-sdk => $sdk
replace google.golang.org/grpc => github.com/omniviewdev/grpc-go v1.85.1-0.20261107225428-6ba964c95af2
EOF
	cp "$sdk/go.sum" "$work/go.sum"
	(cd "$work" && go build -o "$out/$name" .)
	rm -rf "$work"
	echo "built $out/$name  (SDK: $sdk)"
}

build notes-old020 "$v0200"
build notes-old021 "$v0210"
build notes-new "$new"
