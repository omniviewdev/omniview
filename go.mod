module github.com/omniviewdev/omniview

go 1.21.3

require (
	github.com/creack/pty v1.1.21
	github.com/fsnotify/fsnotify v1.7.0
	github.com/go-enry/go-enry/v2 v2.8.7
	github.com/google/uuid v1.4.0
	github.com/hashicorp/go-hclog v1.6.2
	github.com/hashicorp/go-plugin v1.6.0
	github.com/omniviewdev/plugin-sdk v0.0.0-20240314004425-c2572eb4a1c1
	github.com/omniviewdev/settings v0.0.0-00010101000000-000000000000
	github.com/vrischmann/userdir v0.0.0-20151206171402-20f291cebd68
	github.com/wailsapp/mimetype v1.4.1
	github.com/wailsapp/wails/v2 v2.8.0
	go.uber.org/zap v1.27.0
	golang.org/x/exp v0.0.0-20230522175609-2e198f4a06a1
	gopkg.in/yaml.v2 v2.4.0
	gopkg.in/yaml.v3 v3.0.1
	k8s.io/client-go v0.29.2
)

require (
	github.com/bep/debounce v1.2.1 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/emicklei/go-restful/v3 v3.11.0 // indirect
	github.com/fatih/color v1.14.1 // indirect
	github.com/go-enry/go-oniguruma v1.2.1 // indirect
	github.com/go-logr/logr v1.3.0 // indirect
	github.com/go-ole/go-ole v1.2.6 // indirect
	github.com/go-openapi/jsonpointer v0.19.6 // indirect
	github.com/go-openapi/jsonreference v0.20.2 // indirect
	github.com/go-openapi/swag v0.22.3 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/golang/protobuf v1.5.3 // indirect
	github.com/google/gnostic-models v0.6.8 // indirect
	github.com/google/go-cmp v0.6.0 // indirect
	github.com/google/gofuzz v1.2.0 // indirect
	github.com/google/pprof v0.0.0-20221118152302-e6195bd50e26 // indirect
	github.com/grpc-ecosystem/go-grpc-middleware/v2 v2.1.0 // indirect
	github.com/hashicorp/yamux v0.1.1 // indirect
	github.com/jchv/go-winloader v0.0.0-20210711035445-715c2860da7e // indirect
	github.com/josharian/intern v1.0.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/labstack/echo/v4 v4.10.2 // indirect
	github.com/labstack/gommon v0.4.0 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.0 // indirect
	github.com/leaanthony/gosod v1.0.3 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.0 // indirect
	github.com/mailru/easyjson v0.7.7 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/mitchellh/go-testing-interface v0.0.0-20171004221916-a61a99592b77 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/oklog/run v1.0.0 // indirect
	github.com/pkg/browser v0.0.0-20210911075715-681adbf594b8 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/rivo/uniseg v0.4.4 // indirect
	github.com/samber/lo v1.38.1 // indirect
	github.com/tkrajina/go-reflector v0.5.6 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/wailsapp/go-webview2 v1.0.10 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/crypto v0.19.0 // indirect
	golang.org/x/net v0.21.0 // indirect
	golang.org/x/oauth2 v0.16.0 // indirect
	golang.org/x/sys v0.17.0 // indirect
	golang.org/x/term v0.17.0 // indirect
	golang.org/x/text v0.14.0 // indirect
	golang.org/x/time v0.3.0 // indirect
	google.golang.org/appengine v1.6.8 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240213162025-012b6fc9bca9 // indirect
	google.golang.org/grpc v1.61.1 // indirect
	google.golang.org/protobuf v1.33.0 // indirect
	gopkg.in/inf.v0 v0.9.1 // indirect
	k8s.io/api v0.29.2 // indirect
	k8s.io/apimachinery v0.29.2 // indirect
	k8s.io/klog/v2 v2.110.1 // indirect
	k8s.io/kube-openapi v0.0.0-20231010175941-2dd684a91f00 // indirect
	k8s.io/utils v0.0.0-20230726121419-3b25d923346b // indirect
	sigs.k8s.io/json v0.0.0-20221116044647-bc3834ca7abd // indirect
	sigs.k8s.io/structured-merge-diff/v4 v4.4.1 // indirect
	sigs.k8s.io/yaml v1.3.0 // indirect
)

// replace github.com/wailsapp/wails/v2 v2.8.0 => /Users/joshuapare/go/pkg/mod
replace github.com/omniviewdev/plugin-sdk => ./pkg/plugin-sdk

replace github.com/omniviewdev/settings => ./pkg/settings
