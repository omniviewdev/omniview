//go:build linux && cgo

// Standalone synthetic proof, not a production credential or database API.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"time"

	"github.com/godbus/dbus/v5"
)

const service = "org.freedesktop.secrets"
const iface = "org.freedesktop.Secret."

var ctx context.Context
var conn *dbus.Conn

type secret struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string
}
type vault struct {
	collection, session dbus.ObjectPath
	items               map[string]dbus.ObjectPath
	prefix              string
}

func call(path dbus.ObjectPath, method string, args ...any) *dbus.Call {
	return conn.Object(service, path).CallWithContext(ctx, method, 0, args...)
}
func random(n int) []byte {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic("randomness unavailable")
	}
	return b
}
func check(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
func owner() bool {
	var yes bool
	must(conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0, service).Store(&yes))
	return yes
}
func (v *vault) ready() error {
	if !owner() {
		return errors.New("secret service absent; refusing fallback")
	}
	var locked dbus.Variant
	if call(v.collection, "org.freedesktop.DBus.Properties.Get", iface+"Collection", "Locked").Store(&locked) != nil {
		return errors.New("collection state unavailable")
	}
	if locked.Value() != false {
		return errors.New("collection locked; refusing fallback")
	}
	return nil
}
func (v *vault) put(id string, key []byte) {
	must(v.ready())
	if item, ok := v.items[id]; ok {
		check(call(item, iface+"Item.SetSecret", secret{v.session, []byte{}, key, "application/octet-stream"}).Err == nil, "key replacement failed")
		return
	}
	props := map[string]dbus.Variant{iface + "Item.Label": dbus.MakeVariant(v.prefix + id), iface + "Item.Attributes": dbus.MakeVariant(map[string]string{"application": "history-linux-security-proof", "proof-id": v.prefix + id})}
	var item, prompt dbus.ObjectPath
	check(call(v.collection, iface+"Collection.CreateItem", props, secret{v.session, []byte{}, key, "application/octet-stream"}, false).Store(&item, &prompt) == nil, "key creation failed")
	check(item != "/" && prompt == "/", "interactive key creation not supported")
	v.items[id] = item
}
func (v *vault) get(id string) ([]byte, error) {
	if err := v.ready(); err != nil {
		return nil, err
	}
	item, ok := v.items[id]
	if !ok {
		return nil, errors.New("key absent; refusing fallback")
	}
	var got secret
	if call(item, iface+"Item.GetSecret", v.session).Store(&got) != nil {
		return nil, errors.New("key read denied")
	}
	if len(got.Value) != 32 {
		return nil, errors.New("unexpected key size")
	}
	return got.Value, nil
}
func (v *vault) remove(id string) {
	item, ok := v.items[id]
	check(ok, "key already absent")
	var prompt dbus.ObjectPath
	check(call(item, iface+"Item.Delete").Store(&prompt) == nil && prompt == "/", "key deletion failed")
	var got secret
	check(call(item, iface+"Item.GetSecret", v.session).Store(&got) != nil, "deleted key readable")
	delete(v.items, id)
}
func (v *vault) close() {
	for id := range v.items {
		v.remove(id)
	}
	check(call(v.session, iface+"Session.Close").Err == nil, "session cleanup failed")
}
func (v *vault) open(path, id string) (*sql.DB, error) {
	// Credential availability is checked before SQLite can create or modify files.
	key, err := v.get(id)
	if err != nil {
		return nil, err
	}
	return openCipher(path, key)
}
func (v *vault) lock() {
	var paths []dbus.ObjectPath
	var prompt dbus.ObjectPath
	check(call("/org/freedesktop/secrets", iface+"Service.Lock", []dbus.ObjectPath{v.collection}).Store(&paths, &prompt) == nil && prompt == "/", "collection lock failed")
	check(v.ready() != nil, "locked collection admitted")
}
func main() {
	// Fixed messages avoid leaking key-bearing DSNs or SQL in diagnostics.
	defer func() {
		if recover() != nil {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "failed", "reason": "security proof assertion failed; no secret diagnostics emitted"})
			os.Exit(1)
		}
	}()
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var err error
	conn, err = dbus.ConnectSessionBus()
	must(err)
	defer conn.Close()
	check(len(os.Args) == 2, "expected available or unavailable")
	if os.Args[1] == "unavailable" {
		check(!owner(), "service unexpectedly present")
		must(absentProof())
		must(json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "passed", "vault": "absent-denied", "actual_database_mutation": false, "fallback": false}))
		return
	}
	check(os.Args[1] == "available" && os.Getenv("HISTORY_PROOF_OWNED_SESSION") == "1", "owned session required")
	check(owner(), "service absent")
	v := &vault{items: map[string]dbus.ObjectPath{}, prefix: "history-linux-" + hex.EncodeToString(random(16)) + "-"}
	check(call("/org/freedesktop/secrets", iface+"Service.ReadAlias", "default").Store(&v.collection) == nil && v.collection != "/", "default collection absent")
	must(v.ready())
	var output dbus.Variant
	check(call("/org/freedesktop/secrets", iface+"Service.OpenSession", "plain", dbus.MakeVariant("")).Store(&output, &v.session) == nil, "session negotiation failed")
	defer v.close()
	key := random(32)
	v.put("partition-v1", key)
	got, err := v.get("partition-v1")
	must(err)
	check(bytes.Equal(got, key), "key read mismatch")
	replacement := random(32)
	v.put("partition-v1", replacement)
	got, err = v.get("partition-v1")
	must(err)
	check(bytes.Equal(got, replacement), "key replace mismatch")
	result := cipherProof(v)
	result["status"] = "passed"
	result["vault"] = "create-read-replace-delete"
	result["fallback"] = false
	must(json.NewEncoder(os.Stdout).Encode(result))
}
