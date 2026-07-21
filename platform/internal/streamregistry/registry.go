// Package streamregistry 从能力服务 manifest 加载 stream 声明（Platform 不含业务规则）。
package streamregistry

import (
	"fmt"

	"niuma/pkg/serviceipc/streamspec"
	"niuma/platform/internal/supervisor"
)

// Registry 是 method → 声明式 Spec 的只读表。
type Registry struct {
	byMethod map[string]streamspec.Spec
}

// Load 从 supervisor 已加载的 manifest 构建注册表。
func Load(sup *supervisor.Supervisor) (*Registry, error) {
	reg := &Registry{byMethod: make(map[string]streamspec.Spec)}
	if sup == nil {
		return reg, nil
	}
	for _, m := range sup.AllManifests() {
		for _, spec := range m.Streams {
			if spec.Method == "" {
				continue
			}
			if _, exists := reg.byMethod[spec.Method]; exists {
				return nil, fmt.Errorf("duplicate stream method %q", spec.Method)
			}
			reg.byMethod[spec.Method] = spec
		}
	}
	return reg, nil
}

// Get 按 method 查找声明。
func (r *Registry) Get(method string) (streamspec.Spec, bool) {
	if r == nil {
		return streamspec.Spec{}, false
	}
	spec, ok := r.byMethod[method]
	return spec, ok
}
