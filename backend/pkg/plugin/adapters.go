package plugin

// PluginRefAdapter adapts plugin.Manager to devserver.PluginRef.
type PluginRefAdapter struct{ Mgr Manager }

func (a *PluginRefAdapter) GetDevPluginInfo(pluginID string) (bool, string, error) {
	info, err := a.Mgr.GetPlugin(pluginID)
	if err != nil {
		return false, "", err
	}
	return info.DevMode, info.DevPath, nil
}

// PluginReloaderAdapter adapts plugin.Manager to devserver.PluginReloader.
type PluginReloaderAdapter struct{ Mgr Manager }

func (a *PluginReloaderAdapter) ReloadPlugin(id string) error {
	_, err := a.Mgr.ReloadPlugin(id)
	return err
}
