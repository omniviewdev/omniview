package controllers

import "github.com/infraview/plugin/internal"

type ExecPluginController interface {
	internal.BasePluginController[interface{}]
}
