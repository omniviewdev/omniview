package plugin

import (
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	goplugin "github.com/hashicorp/go-plugin"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sp "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	tp "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// Which plugin protocols the host runs, and what it does with a plugin that speaks another (S4, docs/ui-next/status/S4.md).
//
// go-plugin settles the protocol of a plugin's process by the numbers the host offers: the plugin takes the highest number both sides list, and when there is none it says its lowest anyway, which the client
// refuses with a string and no type ("incompatible API version with plugin"). The host cannot read that string (a cause is never read from the words of an error), so it offers every protocol up to a ceiling:
// go-plugin then names the plugin's protocol, and the host decides from the NUMBER before it dispenses a client from the plugin. A plugin the host refuses is never spoken to at all: its process is killed before
// anything is dialled (refuseProcess). The range the host runs is declared once (plugintypes.AcceptedProtocols), and the offer, the decision and the facts of a refusal are derived from it.

// offeredProtocolCeiling is how far above the protocols it runs the host still lets go-plugin name a plugin's protocol. A plugin more than that many protocols ahead is refused by go-plugin itself, with a string that holds
// the number and no type: the host does not read it (S4 decision: a fact only a library's text carries is not a fact the host has), so the cause is `failed`, with the host's own sentence (handshakeError) and go-plugin's
// words in the host log. A ceiling is a policy, and this one is generous (the host runs 1, and one bump is planned). The cure is the producer's: the plugin stating its protocol where the host reads it before go-plugin does (S4-01).
const offeredProtocolCeiling = 16

// capabilityClients is the set of clients the host speaks to a plugin of an accepted protocol: one per capability the SDK serves. Every accepted protocol has the same set today; the step that makes the host read
// a second protocol gives the plugin of that protocol the clients of its wire here.
func capabilityClients() goplugin.PluginSet {
	return goplugin.PluginSet{
		"resource":  &resourceplugin.GRPCPlugin{NetRPCUnsupportedPlugin: goplugin.NetRPCUnsupportedPlugin{}, Impl: nil, SettingsProvider: nil},
		"exec":      &ep.Plugin{Plugin: nil, Impl: nil},
		"networker": &np.Plugin{Plugin: nil, Impl: nil},
		"log":       &lp.Plugin{Plugin: nil, Impl: nil},
		"metric":    &mp.Plugin{Plugin: nil, Impl: nil},
		"settings":  &sp.SettingsPlugin{Plugin: nil, Impl: nil},
		"tools":     &tp.Plugin{Plugin: nil, Impl: nil},
		"lifecycle": &lc.Plugin{Plugin: nil, Impl: nil},
	}
}

// versionedPlugins is what the host offers go-plugin: every protocol number from the oldest the host runs up to the ceiling. The protocols the host runs carry the clients it speaks to them; the others carry
// none, and a plugin that negotiates one is refused by admitProtocol before the host dials it.
func versionedPlugins() map[int]goplugin.PluginSet {
	accepted := plugintypes.AcceptedProtocols()
	offer := make(map[int]goplugin.PluginSet, offeredProtocolCeiling)
	for protocol := accepted.Oldest; protocol <= max(accepted.Newest, offeredProtocolCeiling); protocol++ {
		if accepted.Contains(protocol) {
			offer[protocol] = capabilityClients()
		} else {
			offer[protocol] = goplugin.PluginSet{}
		}
	}
	return offer
}

// admitProtocol is the host's decision on the protocol a started plugin negotiated: nil when the host runs it, else the typed refusal that carries both numbers. Nothing of any error's text is read.
func admitProtocol(negotiated int) error {
	accepted := plugintypes.AcceptedProtocols()
	if accepted.Contains(negotiated) {
		return nil
	}
	return &plugintypes.IncompatibleError{Incompatibility: plugintypes.Incompatibility{PluginProtocol: negotiated, Accepted: accepted}}
}

// handshake starts the plugin's process, reads the protocol it negotiated, decides by that number whether the host runs it, and only then dials. A plugin the host does not run is never dialled, and nothing is said
// to it: refuseProcess ends its process (and cmd is the command the client started it with) before the typed decision is returned. The caller has nothing left to kill: go-plugin's Kill, which it would call for a
// plugin that failed any other way, makes requests of the plugin on an authenticated channel (the first of them with no deadline), which is what a refused plugin must not be made, or be able to hold. A handshake
// that go-plugin refuses for a process that started is a handshakeError (the host's one sentence; the library's words are the cause, for the log); a process that could not be started says the system's own words.
func handshake(client *goplugin.Client, cmd *exec.Cmd) (goplugin.ClientProtocol, error) {
	if _, err := client.Start(); err != nil {
		if cmd.Process == nil {
			return nil, err
		}
		return nil, handshakeError{cause: err}
	}
	if err := admitProtocol(client.NegotiatedVersion()); err != nil {
		refuseProcess(client, cmd)
		return nil, err
	}
	return client.Client()
}

const (
	// refusedReapBound is the longest the host waits for the process of a plugin it refused to be reaped once it is killed. A killed process is reaped in a few milliseconds; the bound is for one that cannot be killed
	// (an uninterruptible wait), which must not hold the load: the refusal is returned all the same.
	refusedReapBound = 2 * time.Second
	refusedReapPoll  = 2 * time.Millisecond
)

// refuseProcess ends the process of a plugin the host refused, and says nothing to it: the process is killed (SIGKILL; the host does not start a plugin in a process group of its own, so there is no group to kill, and
// a process the plugin started is out of reach, as it is whenever the host kills a plugin), the socket the plugin made and could not remove is removed, and go-plugin's reaping of the process is awaited, for at most
// refusedReapBound. Nothing here dials or asks anything of the plugin, so nothing the plugin does can hold it.
func refuseProcess(client *goplugin.Client, cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill() // os.ErrProcessDone: it had ended already
	}
	if reattach := client.ReattachConfig(); reattach != nil {
		unlinkAdvertisedSocket(reattach.Addr, cmd.Env)
	}
	for deadline := time.Now().Add(refusedReapBound); !client.Exited() && time.Now().Before(deadline); {
		time.Sleep(refusedReapPoll)
	}
}

// unlinkAdvertisedSocket removes the socket a plugin the host refused made, which a process that is killed cannot remove itself. The path is the plugin's own word, so it is removed only when it can be nothing but what
// a go-plugin server makes for the environment the host gave it: a file called plugin and a number, directly in the directory the plugin was told to use (PLUGIN_UNIX_SOCKET_DIR, else its TMPDIR, else /tmp), that is a
// socket and not a link to one. Anything else is left alone, and so is a path of any other kind of address (go-plugin listens on TCP on Windows).
func unlinkAdvertisedSocket(addr net.Addr, env []string) {
	if addr == nil || addr.Network() != "unix" {
		return
	}
	path := addr.String()
	dir := lastEnv(env, "PLUGIN_UNIX_SOCKET_DIR")
	if dir == "" {
		dir = lastEnv(env, "TMPDIR")
	}
	if dir == "" {
		dir = "/tmp"
	}
	number, made := strings.CutPrefix(filepath.Base(path), "plugin")
	if !made || number == "" || strings.Trim(number, "0123456789") != "" {
		return
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Dir(path) != filepath.Clean(dir) {
		return
	}
	if info, err := os.Lstat(path); err == nil && info.Mode().Type() == os.ModeSocket {
		_ = os.Remove(path)
	}
}

// lastEnv is the value of key in env: the last one, as the system takes it when a key is there twice.
func lastEnv(env []string, key string) string {
	value := ""
	for _, entry := range env {
		if name, text, found := strings.Cut(entry, "="); found && name == key {
			value = text
		}
	}
	return value
}
