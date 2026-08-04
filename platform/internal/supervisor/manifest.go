package supervisor

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"gopkg.in/yaml.v3"

	"niuma/pkg/serviceipc/streamspec"
)

// Manifest 描述一个 Layer-1 能力服务的注册信息（对应 services/manifests/*.yaml）。
type Manifest struct {
	ID      string `yaml:"id"`
	Name    string `yaml:"name"`
	Version string `yaml:"version"`
	Bridge  struct {
		Namespace      string `yaml:"namespace"`
		ConnectionKind string `yaml:"connection_kind"`
	} `yaml:"bridge"`
	Session struct {
		InjectCredentials bool     `yaml:"inject_credentials"`
		CredentialMethods []string `yaml:"credential_methods"`
	} `yaml:"session"`
	Runtime struct {
		Executable        string `yaml:"executable"`
		ExecutableWindows string `yaml:"executable_windows"`
		ExecutableUnix    string `yaml:"executable_unix"`
		Lang              string `yaml:"lang"`
		NativeRuntime     string `yaml:"native_runtime"`
		// EnvFromComponent 由工具组件解析出的路径注入子进程环境（标准变量名，如 ORACLE_HOME）。
		// platform-core 不识别具体厂商；仅按 manifest 声明通用注入。
		EnvFromComponent []EnvFromComponent `yaml:"env_from_component"`
	} `yaml:"runtime"`
	IPC struct {
		Transport        string `yaml:"transport"`
		TransportWindows string `yaml:"transport_windows"`
		TransportUnix    string `yaml:"transport_unix"`
		Address          string `yaml:"address"`
		AddressWindows   string `yaml:"address_windows"`
		AddressUnix      string `yaml:"address_unix"`
		Protocol         string `yaml:"protocol"`
	} `yaml:"ipc"`
	Lifecycle struct {
		Startup string `yaml:"startup"`
	} `yaml:"lifecycle"`
	Streams []streamspec.Spec `yaml:"streams"`
}

// EnvFromComponent 将 components 工具有效路径映射为子进程环境变量。
type EnvFromComponent struct {
	// Name 标准环境变量名（如 ORACLE_HOME），禁止业务自定义前缀。
	Name string `yaml:"name"`
	// BundleID 对应 components/*/manifest.yaml 的 id。
	BundleID string `yaml:"bundle_id"`
	// ToolID 对应工具项 id。
	ToolID string `yaml:"tool_id"`
	// AsDirectory 为 true 时：若配置的是库文件（如 oci.dll），取其父目录。
	AsDirectory bool `yaml:"as_directory"`
}

// LoadManifests 从 servicesDir/manifests 读取全部 *.yaml（不含 platform-core）。
func LoadManifests(servicesDir string) (map[string]*Manifest, error) {
	dir := filepath.Join(servicesDir, "manifests")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("supervisor: read manifests: %w", err)
	}

	out := make(map[string]*Manifest)
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".yaml") {
			continue
		}
		raw, readErr := os.ReadFile(filepath.Join(dir, ent.Name()))
		if readErr != nil {
			return nil, fmt.Errorf("supervisor: read %s: %w", ent.Name(), readErr)
		}
		var m Manifest
		if err := yaml.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("supervisor: parse %s: %w", ent.Name(), err)
		}
		if m.ID == "" {
			continue
		}
		out[m.ID] = &m
	}
	return out, nil
}

// ExecutablePath 返回可执行文件绝对路径（executable 相对 services 根目录）。
func (m *Manifest) ExecutablePath(servicesDir string) string {
	executable := m.Runtime.Executable
	if runtime.GOOS == "windows" && m.Runtime.ExecutableWindows != "" {
		executable = m.Runtime.ExecutableWindows
	}
	if runtime.GOOS != "windows" && m.Runtime.ExecutableUnix != "" {
		executable = m.Runtime.ExecutableUnix
	}
	exe := strings.TrimPrefix(filepath.ToSlash(executable), "services/")
	return filepath.Join(servicesDir, filepath.FromSlash(exe))
}

// IPCAddress 返回 IPC 监听地址（Windows 为管道路径，其他平台可扩展）。
func (m *Manifest) IPCAddress() string {
	addr := m.IPC.Address
	if runtime.GOOS == "windows" && m.IPC.AddressWindows != "" {
		addr = m.IPC.AddressWindows
	}
	if runtime.GOOS != "windows" && m.IPC.AddressUnix != "" {
		addr = m.IPC.AddressUnix
	}
	return strings.Trim(addr, `"`)
}

// IPCTransport 返回当前平台的 IPC 传输类型。
func (m *Manifest) IPCTransport() string {
	transport := m.IPC.Transport
	if runtime.GOOS == "windows" && m.IPC.TransportWindows != "" {
		transport = m.IPC.TransportWindows
	}
	if runtime.GOOS != "windows" && m.IPC.TransportUnix != "" {
		transport = m.IPC.TransportUnix
	}
	return transport
}

// NeedsCredentialInjection 判断服务内方法是否需由 platform 注入站点凭据。
func (m *Manifest) NeedsCredentialInjection(action string) bool {
	if !m.Session.InjectCredentials {
		return false
	}
	methods := m.Session.CredentialMethods
	if len(methods) == 0 {
		methods = []string{"session.open", "session.test"}
	}
	for _, method := range methods {
		if method == action {
			return true
		}
	}
	return false
}
