package components

import (
	"context"
	"strings"

	"niuma/platform/internal/supervisor"
)

// PathResolver 解析工具组件有效路径（Registry 实现）。
type PathResolver interface {
	EffectivePath(ctx context.Context, bundleID, toolID string) (string, error)
}

// BindComponentEnv 按各服务 manifest 的 runtime.env_from_component 通用注入环境变量。
// platform-core / supervisor 不硬编码具体厂商（如 Oracle）；声明写在 services/manifests/*.yaml。
func BindComponentEnv(sup *supervisor.Supervisor, paths PathResolver) {
	if sup == nil || paths == nil {
		return
	}
	sup.SetEnvProvider(func(ctx context.Context, serviceID string) []string {
		m, err := sup.Manifest(serviceID)
		if err != nil || m == nil {
			return nil
		}
		specs := m.Runtime.EnvFromComponent
		if len(specs) == 0 {
			return nil
		}
		out := make([]string, 0, len(specs))
		for _, spec := range specs {
			name := strings.TrimSpace(spec.Name)
			bundleID := strings.TrimSpace(spec.BundleID)
			toolID := strings.TrimSpace(spec.ToolID)
			if name == "" || bundleID == "" || toolID == "" {
				continue
			}
			path, pathErr := paths.EffectivePath(ctx, bundleID, toolID)
			if pathErr != nil || path == "" {
				continue
			}
			value := path
			if spec.AsDirectory {
				value = NormalizeConfiguredDir(path)
			}
			if value == "" {
				continue
			}
			out = append(out, name+"="+value)
		}
		if len(out) == 0 {
			return nil
		}
		return out
	})
}
