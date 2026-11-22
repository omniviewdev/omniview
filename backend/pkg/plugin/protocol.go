package plugin

import (
	"sync"

	goplugin "github.com/hashicorp/go-plugin"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/releasechannel"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sp "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	tp "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// S0 (SDK0-S0-dual-read.md). The host reads two plugin protocols at once, each with its own
// resource wire, and decides which plugin it refuses by NUMBER.

const (
	// offeredProtocolCeiling is how far above what it runs the host still lets go-plugin name a plugin's
	// protocol. go-plugin fails a handshake it cannot match with a string and no type
	// ("incompatible API version with plugin. Plugin version: N, Client versions: [..]"); a protocol the
	// host offers is matched, and the host reads the number from NegotiatedVersion and decides.
	offeredProtocolCeiling = 16

	// The oldest plugin protocol each kind of release channel accepts. The feature channel moves to 2 in the
	// host change that moves the Kubernetes plugin ref to a protocol-2 build; the rest follow at the flip.
	stableProtocolFloor  = 1
	featureProtocolFloor = 2
)

// protocolFloor is the oldest plugin protocol this host runs for its release channel.
func (pm *pluginManager) protocolFloor() int {
	if pm.minProtocol > 0 {
		return pm.minProtocol
	}
	if pm.registryClient != nil && releasechannel.IsFeature(pm.registryClient.HostReleaseChannel()) {
		return featureProtocolFloor
	}
	return stableProtocolFloor
}

// readWireFloorOnce lowers the strict reader's floor once per process. The floor is process-wide because the gRPC codec registry is, so
// it belongs to the host, not to any plugin: a plugin process keeps the SDK's default and reads exactly its own wire.
var readWireFloorOnce sync.Once

func readTheWiresOfEveryProtocol() {
	readWireFloorOnce.Do(func() {
		oldest, _ := plugintypes.ResourceWire(plugintypes.MinProtocolVersion)
		if err := resourceplugin.SetReadWireFloor(oldest); err != nil {
			panic(err) // the SDK this host is built on cannot read the wire its own protocol table names
		}
	})
}

// versionedPlugins is what the host offers go-plugin: every protocol number up to the ceiling. The ones the
// host runs carry the capability set its client speaks to a plugin of that protocol (the resource client
// with the wire of that protocol); the rest carry none, and a plugin that negotiates one is refused by
// admitProtocol before anything is dialled.
func versionedPlugins() map[int]goplugin.PluginSet {
	readTheWiresOfEveryProtocol()
	sets := make(map[int]goplugin.PluginSet, offeredProtocolCeiling)
	for protocol := plugintypes.MinProtocolVersion; protocol <= offeredProtocolCeiling; protocol++ {
		wire, runs := plugintypes.ResourceWire(protocol)
		if !runs {
			sets[protocol] = goplugin.PluginSet{}
			continue
		}
		sets[protocol] = goplugin.PluginSet{
			"resource":  &resourceplugin.GRPCPlugin{PeerWire: wire},
			"exec":      &ep.Plugin{Plugin: nil, Impl: nil},
			"networker": &np.Plugin{Plugin: nil, Impl: nil},
			"log":       &lp.Plugin{Plugin: nil, Impl: nil},
			"metric":    &mp.Plugin{Plugin: nil, Impl: nil},
			"settings":  &sp.SettingsPlugin{Plugin: nil, Impl: nil},
			"tools":     &tp.Plugin{Plugin: nil, Impl: nil},
			"lifecycle": &lc.Plugin{Plugin: nil, Impl: nil},
		}
	}
	return sets
}

// admitProtocol is the host's typed decision on the protocol a started plugin negotiated: nil when the host
// runs it for its channel, else an *IncompatibleError carrying both numbers. Nothing of any error's text is read.
func (pm *pluginManager) admitProtocol(negotiated int) error {
	floor := pm.protocolFloor()
	if negotiated >= floor && plugintypes.RunsProtocol(negotiated) {
		return nil
	}
	return &plugintypes.IncompatibleError{Incompatibility: plugintypes.Incompatibility{
		PluginProtocol: negotiated,
		HostFloor:      floor,
		HostNewest:     plugintypes.CurrentProtocolVersion,
	}}
}
