// Package tunnel 提供 connection_options.tunnel 的通用解析与注入工具。
package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
)

const (
	// TypeNone 表示不启用隧道。
	TypeNone = "none"
	// TypeSSH 表示通过 SSH direct-tcpip 隧道连接目标服务。
	TypeSSH = "ssh"
	// ConnectionKindSSH 是连接站点中 SSH profile 的公共 kind。
	ConnectionKindSSH = "ssh"
)

// SSHProfile 是注入到 connection_options.tunnel.sshProfile 的运行时 SSH 连接资料。
//
// Secret 承载认证凭据（密码或私钥内容）；新字段名为 `secret`，兼容历史 `password`。
type SSHProfile struct {
	HostAddress  string          `json:"hostAddress"`
	PortNumber   int             `json:"portNumber"`
	LoginAccount string          `json:"loginAccount"`
	Secret       string          `json:"secret"`
	Options      json.RawMessage `json:"options"`
}

// UnmarshalJSON 兼容历史 `password` 字段。
func (p *SSHProfile) UnmarshalJSON(data []byte) error {
	type alias SSHProfile
	var raw struct {
		alias
		Password string `json:"password"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = SSHProfile(raw.alias)
	if p.Secret == "" && raw.Password != "" {
		p.Secret = raw.Password
	}
	return nil
}

// MarshalJSON 序列化时输出 secret 字段。
func (p SSHProfile) MarshalJSON() ([]byte, error) {
	type alias SSHProfile
	return json.Marshal(alias(p))
}

// ProfileResolver 根据 sshProfileId 解析 SSH profile，并注入进程内可用的敏感凭据。
type ProfileResolver interface {
	ResolveSSHProfile(ctx context.Context, profileID string) (SSHProfile, error)
}

// ProfileResolverFunc 允许调用方用函数适配 ProfileResolver。
type ProfileResolverFunc func(ctx context.Context, profileID string) (SSHProfile, error)

// ResolveSSHProfile 实现 ProfileResolver。
func (f ProfileResolverFunc) ResolveSSHProfile(ctx context.Context, profileID string) (SSHProfile, error) {
	return f(ctx, profileID)
}

// InjectSSHProfile 将 connection_options.tunnel.sshProfileId 指向的 profile 展开为
// tunnel.sshProfile，供各能力服务直接消费。非 SSH tunnel 或未配置 sshProfileId 时原样返回。
func InjectSSHProfile(ctx context.Context, options json.RawMessage, resolver ProfileResolver) (json.RawMessage, error) {
	if len(options) == 0 || string(options) == "null" {
		return options, nil
	}
	var root map[string]any
	if err := json.Unmarshal(options, &root); err != nil {
		return nil, fmt.Errorf("tunnel: invalid options: %w", err)
	}
	rawTunnel, ok := root["tunnel"].(map[string]any)
	if !ok {
		return options, nil
	}
	tunnelType, _ := rawTunnel["type"].(string)
	if tunnelType != TypeSSH {
		return options, nil
	}
	sshProfileID, _ := rawTunnel["sshProfileId"].(string)
	if sshProfileID == "" {
		return options, nil
	}
	if resolver == nil {
		return nil, fmt.Errorf("tunnel: ssh profile resolver required")
	}
	profile, err := resolver.ResolveSSHProfile(ctx, sshProfileID)
	if err != nil {
		return nil, err
	}
	rawTunnel["sshProfile"] = profile
	root["tunnel"] = rawTunnel
	out, err := json.Marshal(root)
	if err != nil {
		return nil, err
	}
	return out, nil
}
