//go:build linux

// This standalone proof uses synthetic secrets only. It is not a production vault API.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/godbus/dbus/v5"
	_ "modernc.org/sqlite"
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

func call(path dbus.ObjectPath, method string, args ...any) *dbus.Call {
	return conn.Object(service, path).CallWithContext(ctx, method, 0, args...)
}
func prop(path dbus.ObjectPath, name string) (dbus.Variant, error) {
	var v dbus.Variant
	err := call(path, "org.freedesktop.DBus.Properties.Get", iface+"Collection", name).Store(&v)
	return v, err
}
func random(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
func require(ok bool, text string) error {
	if !ok {
		return errors.New(text)
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "failed", "reason": err.Error()})
		os.Exit(1)
	}
}
func run() (err error) {
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if len(os.Args) != 2 || (os.Args[1] != "available" && os.Args[1] != "unavailable") {
		return errors.New("usage: historylinuxsecurityprobe available|unavailable")
	}
	conn, err = dbus.ConnectSessionBus()
	if err != nil {
		return errors.New("session bus unavailable")
	}
	defer conn.Close()
	var owner bool
	if err = conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0, service).Store(&owner); err != nil {
		return errors.New("service owner query failed")
	}
	if os.Args[1] == "unavailable" {
		// Do not activate a service or create disk state when credentials are unavailable.
		if owner {
			return errors.New("unavailable scenario unexpectedly has service owner")
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "passed", "vault": "absent-denied", "fallback": false})
	}
	if !owner {
		return errors.New("secret service absent; refusing fallback")
	}
	var collection dbus.ObjectPath
	if err = call("/org/freedesktop/secrets", iface+"Service.ReadAlias", "default").Store(&collection); err != nil {
		return errors.New("default collection unavailable")
	}
	if collection == "/" {
		return errors.New("default collection absent; refusing fallback")
	}
	v, e := prop(collection, "Locked")
	if e != nil {
		return errors.New("collection state unavailable")
	}
	locked, ok := v.Value().(bool)
	if !ok || locked {
		return errors.New("collection locked; refusing fallback")
	}
	var session dbus.ObjectPath
	var output dbus.Variant
	if err = call("/org/freedesktop/secrets", iface+"Service.OpenSession", "plain", dbus.MakeVariant("")).Store(&output, &session); err != nil {
		return errors.New("session negotiation failed")
	}
	if os.Getenv("HISTORY_PROOF_OWNED_SESSION") != "1" {
		return errors.New("owned session attestation required")
	}
	defer call(session, iface+"Session.Close")
	id := hex.EncodeToString(random(16))
	key := random(32)
	replacement := random(32)
	properties := map[string]dbus.Variant{iface + "Item.Label": dbus.MakeVariant("history-linux-proof-" + id), iface + "Item.Attributes": dbus.MakeVariant(map[string]string{"application": "history-linux-security-proof", "proof-id": id})}
	var item, prompt dbus.ObjectPath
	if err = call(collection, iface+"Collection.CreateItem", properties, secret{session, []byte{}, key, "application/octet-stream"}, false).Store(&item, &prompt); err != nil {
		return errors.New("item creation denied")
	}
	if item == "/" || prompt != "/" {
		return errors.New("item creation requires interactive prompt")
	}
	deleted := false
	defer func() {
		if !deleted {
			var p dbus.ObjectPath
			e := call(item, iface+"Item.Delete").Store(&p)
			if e != nil || p != "/" {
				err = errors.New("owned item cleanup failed")
			}
		}
	}()
	readKey := func(expected []byte) error {
		var got secret
		if call(item, iface+"Item.GetSecret", session).Store(&got) != nil {
			return errors.New("key read denied")
		}
		return require(bytes.Equal(got.Value, expected), "key round trip mismatch")
	}
	if err = readKey(key); err != nil {
		return err
	}
	if err = call(item, iface+"Item.SetSecret", secret{session, []byte{}, replacement, "application/octet-stream"}).Err; err != nil {
		return errors.New("key replacement denied")
	}
	if err = readKey(replacement); err != nil {
		return err
	}
	if err = call(item, iface+"Item.Delete").Store(&prompt); err != nil || prompt != "/" {
		return errors.New("key deletion denied")
	}
	deleted = true
	var gone secret
	if call(item, iface+"Item.GetSecret", session).Store(&gone) == nil {
		return errors.New("deleted key remains readable")
	}
	// Lock only the disposable collection inside the owned session created by smoke.sh.
	if os.Getenv("HISTORY_PROOF_OWNED_SESSION") != "1" {
		return errors.New("owned session attestation required")
	}
	var paths []dbus.ObjectPath
	if err = call("/org/freedesktop/secrets", iface+"Service.Lock", []dbus.ObjectPath{collection}).Store(&paths, &prompt); err != nil || prompt != "/" {
		return errors.New("collection lock failed")
	}
	v, e = prop(collection, "Locked")
	if e != nil || v.Value() != true {
		return errors.New("locked state not confirmed")
	}
	if call(collection, iface+"Collection.CreateItem", properties, secret{session, []byte{}, random(32), "application/octet-stream"}, false).Err == nil {
		return errors.New("locked collection accepted write")
	}
	if err = files(); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "passed", "vault": "create-read-replace-delete", "locked": "denied", "fallback": false, "files": "private-db-wal-shm", "containment": "preexisting-symlinks-rejected", "encryption": "not-tested-by-this-proof"})
}

// refuseLinks is a preflight, not a race-proof SQLite VFS. Private parent ownership
// prevents other UIDs introducing sidecars; same-UID adversaries remain out of scope.
func refuseLinks(dir string) error {
	for _, name := range []string{"proof.db", "proof.db-wal", "proof.db-shm"} {
		info, err := os.Lstat(filepath.Join(dir, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("database or sidecar is not regular")
		}
	}
	return nil
}
func files() error {
	dir, err := os.MkdirTemp("", "history-linux-proof-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if info.Mode().Perm() != 0700 || !owned(info) {
		return errors.New("directory mode or owner not private")
	}
	// Set process umask before SQLite creates any sidecar. This standalone process
	// has no concurrent application goroutines creating files.
	setPrivateUmask()
	target := filepath.Join(dir, "outside")
	if err = os.WriteFile(target, []byte("sentinel"), 0600); err != nil {
		return err
	}
	for _, name := range []string{"proof.db", "proof.db-wal", "proof.db-shm"} {
		path := filepath.Join(dir, name)
		if err = os.Symlink(target, path); err != nil {
			return err
		}
		if refuseLinks(dir) == nil {
			return errors.New("symlink preflight failed")
		}
		if err = os.Remove(path); err != nil {
			return err
		}
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "proof.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err = db.ExecContext(ctx, "PRAGMA journal_mode=WAL; CREATE TABLE proof(value BLOB); INSERT INTO proof VALUES(randomblob(32));"); err != nil {
		return errors.New("private sqlite setup failed")
	}
	if err = refuseLinks(dir); err != nil {
		return err
	}
	for _, name := range []string{"proof.db", "proof.db-wal", "proof.db-shm"} {
		info, err = os.Stat(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("sidecar missing: %s", name)
		}
		if info.Mode().Perm() != 0600 || !owned(info) {
			return fmt.Errorf("file mode or owner not private: %s", name)
		}
	}
	return nil
}
