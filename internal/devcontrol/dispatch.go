//go:build devcontrol

package devcontrol

import (
	"context"

	"github.com/omniviewdev/omniview/internal/devcontract"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func publicPlugin(p sdktypes.PluginInfo) sdktypes.PluginInfo {
	if p.LastError != "" {
		p.LastError = "plugin reported an error; inspect local diagnostics"
	}
	return p
}
func (s *Server) dispatch(ctx context.Context, r devcontract.Request) devcontract.Response {
	bad := func() devcontract.Response { return s.result(r, nil, invalidParams()) }
	switch r.Operation {
	case "instance.inspect", "plugin.list":
		var p EmptyParams
		if strictParams(r.Params, &p) != nil {
			return bad()
		}
		if r.Operation == "plugin.list" {
			plugins := s.adapters.Plugins.ListPlugins()
			for i := range plugins {
				plugins[i] = publicPlugin(plugins[i])
			}
			return s.result(r, plugins, nil)
		}
		d, err := s.adapters.Inspect(ctx)
		if err != nil {
			return s.result(r, nil, err)
		}
		s.mu.Lock()
		d.Endpoints.Control = s.descriptor.Endpoints.Control
		s.mu.Unlock()
		// Raw downstream error strings are never control protocol diagnostics.
		if d.LastError != nil {
			d.LastError = safeError(d.LastError)
		}
		for i := range d.Plugins {
			if d.Plugins[i].LastError != nil {
				d.Plugins[i].LastError = safeError(d.Plugins[i].LastError)
			}
		}
		return s.result(r, d, nil)
	case "plugin.install-archive", "plugin.dev.link":
		var p PathParams
		if strictParams(r.Params, &p) != nil || p.Path == "" {
			return bad()
		}
		return s.accept(r, func(ctx context.Context) (any, error) {
			if r.Operation == "plugin.install-archive" {
				return s.adapters.Plugins.InstallPluginFromPath(p.Path)
			}
			plugin, err := s.adapters.Plugins.InstallDevPluginFromPath(p.Path)
			if err != nil {
				return nil, err
			}
			state, err := s.adapters.Dev.Status(plugin.ID)
			if err != nil {
				return nil, err
			}
			_, err = s.adapters.Dev.WaitReady(ctx, plugin.ID, state.Generation)
			return publicPlugin(plugin), err
		})
	case "plugin.install-version":
		var p VersionParams
		if strictParams(r.Params, &p) != nil || p.ID == "" || p.Version == "" {
			return bad()
		}
		return s.accept(r, func(context.Context) (any, error) { return s.adapters.Plugins.InstallPluginVersion(p.ID, p.Version) })
	case "plugin.get", "plugin.uninstall", "plugin.dev.unlink", "plugin.dev.start", "plugin.dev.stop", "plugin.dev.restart", "plugin.dev.status":
		var p PluginParams
		if strictParams(r.Params, &p) != nil || p.ID == "" {
			return bad()
		}
		switch r.Operation {
		case "plugin.get":
			plugin, err := s.adapters.Plugins.GetPlugin(p.ID)
			return s.result(r, publicPlugin(plugin), err)
		case "plugin.dev.status":
			state, err := s.adapters.Dev.Status(p.ID)
			return s.result(r, state, err)
		default:
			return s.accept(r, func(ctx context.Context) (any, error) {
				switch r.Operation {
				case "plugin.uninstall":
					plugin, err := s.adapters.Plugins.UninstallPlugin(p.ID)
					return publicPlugin(plugin), err
				case "plugin.dev.unlink":
					plugin, err := s.adapters.Plugins.UnlinkDevPlugin(p.ID)
					return publicPlugin(plugin), err
				case "plugin.dev.start":
					return s.adapters.Dev.Start(ctx, p.ID)
				case "plugin.dev.restart":
					return s.adapters.Dev.Restart(ctx, p.ID)
				default:
					return nil, s.adapters.Dev.Stop(ctx, p.ID)
				}
			})
		}
	case "plugin.dev.rebuild":
		var p RebuildParams
		if strictParams(r.Params, &p) != nil || p.ID == "" || p.Generation == "" {
			return bad()
		}
		return s.accept(r, func(ctx context.Context) (any, error) { return s.adapters.Dev.Rebuild(ctx, p.ID, p.Generation) })
	case "plugin.dev.dependencies":
		var p struct {
			ID         string `json:"id"`
			Generation string `json:"generation"`
			Enabled    *bool  `json:"enabled"`
		}
		if strictParams(r.Params, &p) != nil || p.ID == "" || p.Generation == "" || p.Enabled == nil {
			return bad()
		}
		enabled := *p.Enabled
		return s.accept(r, func(ctx context.Context) (any, error) {
			return nil, s.adapters.Dev.SetDependencyWatching(ctx, p.ID, p.Generation, enabled)
		})
	case "plugin.dev.logs":
		var p LogsParams
		if strictParams(r.Params, &p) != nil || p.ID == "" || p.Cursor < 0 || p.Limit < 0 || p.Limit > 500 {
			return bad()
		}
		if p.Limit == 0 {
			p.Limit = 100
		}
		logs, err := s.adapters.Dev.Logs(p.ID, p.Cursor, p.Limit, p.IncludeOutput)
		return s.result(r, logs, err)
	case "settings.schema", "settings.get", "settings.set", "settings.bulk":
		var p SettingsParams
		if strictParams(r.Params, &p) != nil || (p.Scope != "host" && p.Scope != "plugin") || (p.Scope == "plugin" && p.PluginID == "") || (p.Scope == "host" && p.PluginID != "") {
			return bad()
		}
		if r.Operation == "settings.schema" || r.Operation == "settings.get" {
			if len(p.Value) != 0 || p.Values != nil || r.Operation == "settings.schema" && p.ID != "" {
				return bad()
			}
			if r.Operation == "settings.schema" {
				schema, err := s.adapters.Settings.Schema(p)
				return s.result(r, schema, err)
			}
			value, err := s.adapters.Settings.Get(p)
			return s.result(r, value, err)
		}
		if r.Operation == "settings.set" {
			if p.ID == "" || len(p.Value) == 0 || p.Values != nil {
				return bad()
			}
			return s.accept(r, func(context.Context) (any, error) { return s.adapters.Settings.Set(p) })
		}
		if p.ID != "" || len(p.Value) != 0 || len(p.Values) == 0 {
			return bad()
		}
		return s.accept(r, func(context.Context) (any, error) { return s.adapters.Settings.Bulk(p) })
	case "operation.get", "operation.wait":
		var p OperationParams
		if strictParams(r.Params, &p) != nil || p.OperationID == "" || p.TimeoutMS < 0 || p.TimeoutMS > 30000 || r.Operation == "operation.get" && p.TimeoutMS != 0 {
			return bad()
		}
		return s.getOperation(ctx, r, p, r.Operation == "operation.wait")
	default:
		return s.result(r, nil, devcontract.Fail(2, "unknown_operation", ""))
	}
}
