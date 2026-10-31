package transportjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
)

// Exercise the actual handwritten TypeScript writer, Wails outer JSON.stringify,
// strict Go DTO decoding, binary protobuf, Go response JSON and Node JSON.parse.
func TestExactRequestJSONAcrossJavaScriptGoAndProto(t *testing.T) {
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	script := `const {encodeRequestJSON}=require('./packages/omniviewdev-runtime/src/resource/v2/requestJSON.ts');
 const body={kind:'map',value:{zero:{kind:'double',value:-0},uint:{kind:'uint64',value:'18446744073709551615'},payload:{kind:'string',value:'x'.repeat(8<<20)}}};
 const request={route:{connection:'connection'},reference:{address:{provider:'test',authority:'authority',type:'pods',scope:[],id:'pod'}},operation:'update',input:body};
 process.stdout.write(JSON.stringify(['test',encodeRequestJSON(request,['test'])]));`
	command := exec.Command("node", "-e", script)
	command.Dir = root
	var stderr bytes.Buffer
	command.Stderr = &stderr
	data, err := command.Output()
	if err != nil {
		t.Fatalf("Node request encoding: %v: %s", err, stderr.String())
	}
	var args []string
	if err := json.Unmarshal(data, &args); err != nil {
		t.Fatal(err)
	}
	var request resourcev2.MutationRequest
	if err := Decode(args[1], &request); err != nil {
		t.Fatal(err)
	}
	if !math.Signbit(request.Input.Map["zero"].Double) {
		t.Fatal("negative zero lost at Wails admission")
	}
	encoded, err := resourcev2.ToProtoMutationRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := proto.Marshal(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var received resourcepb.MutationInput
	if err := proto.Unmarshal(wire, &received); err != nil {
		t.Fatal(err)
	}
	decoded, err := resourcev2.FromProtoMutationRequest(&received)
	if err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal(decoded.Input)
	if err != nil {
		t.Fatal(err)
	}
	assertion := exec.Command("node", "-e", `let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>{const v=JSON.parse(s).value;if(!Object.is(v.zero.value,-0)||v.uint.value!=='18446744073709551615'||v.payload.value.length!==(8<<20))process.exit(1)});`)
	assertion.Stdin = bytes.NewReader(response)
	if output, err := assertion.CombinedOutput(); err != nil {
		t.Fatalf("Node response parse: %v: %s", err, output)
	}
	// The utility boundary uses the same exact request string and SDK admission.
	var options execsdk.SessionOptions
	if err := Decode(`{"resource_plugin":"test","resource_key":"pods","resource_data":`+string(response)+`}`, &options); err != nil {
		t.Fatal(err)
	}
	if options.ResourceData == nil || !math.Signbit(options.ResourceData.Map["zero"].Double) {
		t.Fatal("exec request lost negative zero")
	}
}

func TestEncodedRequestRejectsRawAndEscapedOversize(t *testing.T) {
	var value resourcev2.Value
	if err := Decode(strings.Repeat(" ", resourcev2.MaxMessageBytes+1), &value); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
		t.Fatalf("inner limit: %v", err)
	}
	// Inner bytes fit; quoting backslashes in the Wails envelope exceeds its
	// independent 64 MiB profile after the reserved routing/envelope allowance.
	encoded := `"` + strings.Repeat(`\\`, (32<<20)/2-2) + `"`
	if err := Decode(encoded, &value); resourcev2.ErrorCode(err) != "RESOURCE_LIMIT" {
		t.Fatalf("outer escaped limit: %v", err)
	}
}

func TestDecodeFailuresUseCanonicalHostErrors(t *testing.T) {
	var envelope struct {
		Body resourcev2.Value `json:"body"`
	}
	err := Decode(`{"body":{"kind":"double","value":-0},"unknown":true}`, &envelope)
	var classified *apperror.AppError
	if !errors.As(err, &classified) || classified.Code != "INVALID_REQUEST" || classified.RequestID == "" {
		t.Fatalf("missing canonical host error/correlation: %v", err)
	}
	first := classified.RequestID
	err = Decode(`{"body":{"kind":"unknown"}}`, &envelope)
	if !errors.As(err, &classified) || classified.Code != "INVALID_REQUEST" || classified.RequestID == "" || classified.RequestID == first {
		t.Fatalf("typed SDK error/correlation not preserved: %v", err)
	}
}
