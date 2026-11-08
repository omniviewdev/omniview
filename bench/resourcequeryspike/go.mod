// Verification-only selected candidate; not imported by the host product.
// Remote immutable fork admission is scoped to P01 conformance, not production.
module github.com/omniviewdev/omniview/bench/resourcequeryspike

go 1.27.0

require cel.dev/cel-go v0.33.1

replace cel.dev/cel-go => github.com/omniviewdev/cel-go v0.33.2-0.20261028172556-d7bb038d8c7b

require (
	cel.dev/expr v0.25.3 // indirect
	github.com/antlr4-go/antlr/v4 v4.13.1 // indirect
	go.yaml.in/yaml/v3 v3.0.6 // indirect
	golang.org/x/exp v0.0.0-20261106192419-47ce03d25ef0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20261104224025-d1e00e9f33ab // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20261104224025-d1e00e9f33ab // indirect
	google.golang.org/protobuf v1.36.12 // indirect
)
