package controllers

import "github.com/infraview/plugin/internal"

type ReporterPluginController interface {
	internal.BasePluginController[interface{}]
}
