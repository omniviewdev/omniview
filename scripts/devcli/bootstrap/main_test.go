package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapCompilesAgainstExplicitSDKBeforeLoadingDevcli(t *testing.T) {
	root := t.TempDir()
	sdk := t.TempDir()
	write := func(path, value string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(root, "go.mod"), "module fixture\n\ngo 1.25.0\n")
	originalModfile := filepath.Join(root, "selected.mod")
	write(originalModfile, "module fixture\n\ngo 1.25.0\n")
	write(filepath.Join(sdk, "go.mod"), "module github.com/omniviewdev/plugin-sdk\n\ngo 1.25.0\n")
	write(filepath.Join(sdk, "pkg/profilecontract/profile.go"), "package profilecontract\nconst Identity = \"selected-contract\"\n")
	// Real Go commands prove that the SDK package is unavailable until the
	// preparation command's modfile is selected. The fixture preparation writes
	// only within the supplied private output capability.
	write(filepath.Join(root, "scripts/nativepatch/main.go"), `package main
import ("flag"; "fmt"; "os"; "path/filepath")
func main() {
 root:=flag.String("root","",""); input:=flag.String("host-modfile","",""); sdk:=flag.String("sdk-source","",""); output:=flag.String("output-directory","",""); flag.Parse()
 if *input != filepath.Join(*root,"selected.mod") { panic("original module authority changed") }
 raw,err:=os.ReadFile(*input); if err!=nil { panic(err) }
 raw=append(raw,[]byte(fmt.Sprintf("require github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n",*sdk))...)
 path:=filepath.Join(*output,"bootstrap.mod"); if err:=os.WriteFile(path,raw,0600); err!=nil { panic(err) }
 if err:=os.WriteFile(os.Getenv("BOOTSTRAP_RECEIPT"),[]byte(*output),0600); err!=nil { panic(err) }; fmt.Println(path)
}`)
	write(filepath.Join(root, "scripts/devcli/main.go"), `package main
import ("flag"; "fmt"; "os"; "path/filepath"; "github.com/omniviewdev/plugin-sdk/pkg/profilecontract")
func main() {
 root:=flag.String("root","",""); input:=flag.String("host-modfile","",""); sdk:=flag.String("sdk-source","",""); flag.Parse()
 if *input!=filepath.Join(*root,"selected.mod") || *sdk!=os.Getenv("EXPECTED_SDK") { panic("source selection authority changed") }; fmt.Println(profilecontract.Identity)
}`)
	receipt := filepath.Join(t.TempDir(), "preparation.txt")
	t.Setenv("BOOTSTRAP_RECEIPT", receipt)
	t.Setenv("EXPECTED_SDK", sdk)
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	var output, diagnostics bytes.Buffer
	err := bootstrap(context.Background(), bootstrapOptions{root: root, modfile: originalModfile, sdkSource: sdk}, &output, &diagnostics)
	if err != nil || strings.TrimSpace(output.String()) != "selected-contract" {
		t.Fatalf("bootstrap did not use explicit SDK before compilation: %v\n%s\n%s", err, &output, &diagnostics)
	}
	temporary, err := os.ReadFile(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(string(temporary)); !os.IsNotExist(err) {
		t.Fatalf("owned preparation outlived bootstrap compilation: %v", err)
	}
	original, err := os.ReadFile(originalModfile)
	if err != nil || string(original) != "module fixture\n\ngo 1.25.0\n" {
		t.Fatalf("bootstrap changed original module input: %v", err)
	}
}

func TestBootstrapRejectsInvalidExplicitSDKBeforeCompilingDevcli(t *testing.T) {
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	for _, sdk := range []string{"relative-sdk", t.TempDir()} {
		t.Run(sdk, func(t *testing.T) {
			var output, diagnostics bytes.Buffer
			err := bootstrap(context.Background(), bootstrapOptions{root: root, sdkSource: sdk}, &output, &diagnostics)
			if err == nil || output.Len() != 0 {
				t.Fatalf("invalid explicit SDK reached CLI compilation: %v, stdout=%s", err, &output)
			}
			if !strings.Contains(err.Error(), "prepare explicit SDK bootstrap module") {
				t.Fatalf("SDK refusal did not occur at native preparation ingress: %v\n%s", err, &diagnostics)
			}
		})
	}
}
