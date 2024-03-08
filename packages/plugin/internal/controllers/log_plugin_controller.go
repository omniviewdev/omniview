package controllers

import "github.com/infraview/plugin/internal"

type LogPluginController interface {
	internal.BasePluginController[interface{}]
}
