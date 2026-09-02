// 本文件按 manifest bridge.namespace 构建能力路由表。
package handler

import (
	"strings"

	"niuma/platform/internal/serviceclient"
	"niuma/platform/internal/supervisor"
)

// capabilityRoute 描述一个已注册能力命名空间及其到 Layer-1 服务的转发配置。
type capabilityRoute struct {
	manifest  *supervisor.Manifest
	namespace string
	client    *serviceclient.Client
}

// CapabilityRegistry 按 manifest bridge.namespace 将 Web 方法路由到能力服务。
type CapabilityRegistry struct {
	supervisor *supervisor.Supervisor
	routes     []*capabilityRoute
	byNS       map[string]*capabilityRoute
}

// NewCapabilityRegistry 从 supervisor 已加载的 manifest 构建路由表。
func NewCapabilityRegistry(sup *supervisor.Supervisor) (*CapabilityRegistry, error) {
	reg := &CapabilityRegistry{
		supervisor: sup,
		byNS:       make(map[string]*capabilityRoute),
	}
	for _, m := range sup.AllManifests() {
		ns := strings.TrimSpace(m.Bridge.Namespace)
		if ns == "" {
			continue
		}
		route := &capabilityRoute{
			manifest:  m,
			namespace: ns,
			client:    serviceclient.New(m.IPCAddress()),
		}
		reg.routes = append(reg.routes, route)
		reg.byNS[ns] = route
	}
	return reg, nil
}

// resolve 按最长前缀匹配 method 对应的能力路由与服务内方法名。
//
// 例：ftp.session.open → namespace=ftp, action=session.open
//
//	com.niuma.db-pg.query.exec → namespace=com.niuma.db-pg, action=query.exec
func (r *CapabilityRegistry) resolve(method string) (*capabilityRoute, string, bool) {
	if r == nil || len(r.routes) == 0 {
		return nil, "", false
	}

	var best *capabilityRoute
	bestLen := -1
	var action string

	for _, route := range r.routes {
		ns := route.namespace
		if method == ns {
			if len(ns) > bestLen {
				best = route
				bestLen = len(ns)
				action = ""
			}
			continue
		}
		prefix := ns + "."
		if strings.HasPrefix(method, prefix) && len(ns) > bestLen {
			best = route
			bestLen = len(ns)
			action = strings.TrimPrefix(method, prefix)
		}
	}
	if best == nil || action == "" {
		return nil, "", false
	}
	return best, action, true
}
