// Package tunnel 提供 connection_options.tunnel 的通用解析、注入与 SSH 隧道拨号工具。
package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"niuma/pkg/netproxy"
)

// Options 与 Web / Rust connection_options.tunnel JSON 对齐（平台注入后的完整结构）。
type Options struct {
	Type         string     `json:"type"`
	SSHProfileID string     `json:"sshProfileId,omitempty"`
	TargetHost   string     `json:"targetHost,omitempty"`
	TargetPort   int        `json:"targetPort,omitempty"`
	SSHProfile   *SSHProfile `json:"sshProfile,omitempty"`
}

// Enabled 报告隧道是否为 SSH 类型且应被激活。
func (o *Options) Enabled() bool {
	return o != nil && o.Type == TypeSSH
}

// sshConnectOptions 与 Rust SshTunnelConnectOptions / Go SSHProfile.Options 对齐。
type sshConnectOptions struct {
	TimeoutSeconds int               `json:"timeout_seconds"`
	AuthType       string            `json:"auth_type"`
	PrivateKeyPath string            `json:"private_key_path"`
	Passphrase     string            `json:"passphrase"`
	Proxy          *netproxy.Options `json:"proxy,omitempty"`
}

// StartSSHTunnel 建立 SSH 跳板隧道，返回本地监听地址（host:port）和关闭函数。
//
// defaultTargetHost/Port 在 Options.TargetHost/Port 未指定时使用（即以最终服务
// 主机/端口为目标），这与 Rust niuma_tunnel::start_ssh_tunnel 语义一致。
//
// 若目标主机与跳板同一地址，会改道 dial 127.0.0.1，避免 hairpin NAT / 本机防火墙
// 导致经跳板访问「自己的局域网 IP」失败；建立后先探测一次 remote Dial，失败则返回明确错误
// （否则 Accept 转发静默掐线，客户端只能看到 connection reset）。
func StartSSHTunnel(
	ctx context.Context,
	opts *Options,
	defaultTargetHost string,
	defaultTargetPort int,
) (localHost string, localPort int, stop func(), err error) {
	if !opts.Enabled() {
		return "", 0, func() {}, nil
	}
	profile := opts.SSHProfile
	if profile == nil {
		return "", 0, nil, fmt.Errorf("tunnel: ssh profile was not injected")
	}
	if profile.HostAddress == "" {
		return "", 0, nil, fmt.Errorf("tunnel: ssh profile host required")
	}

	targetHost, targetPort := resolveTunnelTarget(opts, profile, defaultTargetHost, defaultTargetPort)

	sshClient, err := dialSSHJump(ctx, profile)
	if err != nil {
		return "", 0, nil, err
	}

	if err := probeSSHRemote(sshClient, targetHost, targetPort); err != nil {
		_ = sshClient.Close()
		return "", 0, nil, err
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = sshClient.Close()
		return "", 0, nil, fmt.Errorf("tunnel: local listen: %w", err)
	}

	localPort = listener.Addr().(*net.TCPAddr).Port
	// 隧道生命周期由 stop 控制，不跟请求 ctx 绑定（避免请求结束取消仍在转发的连接）。
	lctx, cancel := context.WithCancel(context.Background())

	go func() {
		for {
			local, aerr := listener.Accept()
			if aerr != nil {
				return
			}
			go forwardConn(lctx, sshClient, local, targetHost, targetPort)
		}
	}()

	stop = func() {
		cancel()
		_ = listener.Close()
		_ = sshClient.Close()
	}
	return "127.0.0.1", localPort, stop, nil
}

// resolveTunnelTarget 解析最终经跳板访问的目标 host:port。
func resolveTunnelTarget(
	opts *Options,
	profile *SSHProfile,
	defaultTargetHost string,
	defaultTargetPort int,
) (string, int) {
	targetHost := strings.TrimSpace(defaultTargetHost)
	if opts.TargetHost != "" {
		targetHost = strings.TrimSpace(opts.TargetHost)
	}
	targetPort := defaultTargetPort
	if opts.TargetPort > 0 {
		targetPort = opts.TargetPort
	}
	if sameTunnelHost(targetHost, profile.HostAddress) {
		targetHost = "127.0.0.1"
	}
	return targetHost, targetPort
}

// sameTunnelHost 判断目标主机与跳板是否同一台（忽略大小写与外围空白）。
func sameTunnelHost(target, jump string) bool {
	a := strings.ToLower(strings.TrimSpace(target))
	b := strings.ToLower(strings.TrimSpace(jump))
	if a == "" || b == "" {
		return false
	}
	return a == b
}

// probeSSHRemote 确认经跳板能 dial 到目标，避免转发失败后被客户端误读成 connection reset。
func probeSSHRemote(sshClient *ssh.Client, host string, port int) error {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	remote, err := sshClient.Dial("tcp", addr)
	if err != nil {
		return fmt.Errorf("tunnel: cannot reach %s via jump host: %w", addr, err)
	}
	_ = remote.Close()
	return nil
}

// forwardConn 将 local 连接经 sshClient direct-tcpip 转发至目标地址。
func forwardConn(ctx context.Context, sshClient *ssh.Client, local net.Conn, host string, port int) {
	defer local.Close()
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	remote, err := sshClient.Dial("tcp", addr)
	if err != nil {
		log.Printf("tunnel: forward dial %s: %v", addr, err)
		return
	}
	defer remote.Close()

	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(remote, local); done <- struct{}{} }()
	go func() { _, _ = io.Copy(local, remote); done <- struct{}{} }()

	select {
	case <-done:
	case <-ctx.Done():
	}
}

// dialSSHJump 连接 SSH 跳板机并完成认证，返回可用于 Dial 的 *ssh.Client。
func dialSSHJump(ctx context.Context, profile *SSHProfile) (*ssh.Client, error) {
	opts := parseSSHOpts(profile)

	timeout := time.Duration(opts.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	authMethods, err := buildSSHAuth(profile, opts)
	if err != nil {
		return nil, err
	}

	config := &ssh.ClientConfig{
		User:            profile.LoginAccount,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // 跳板机由用户自选，host key 验证留待后续
		Timeout:         timeout,
	}

	jumpPort := profile.PortNumber
	if jumpPort == 0 {
		jumpPort = 22
	}
	addr := fmt.Sprintf("%s:%d", profile.HostAddress, jumpPort)

	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	conn, err := netproxy.DialContext(dialCtx, opts.Proxy, "tcp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("tunnel: dial %s: %w", addr, err)
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("tunnel: ssh handshake %s: %w", addr, err)
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

// buildSSHAuth 根据 auth_type 构建认证方法。
func buildSSHAuth(profile *SSHProfile, opts *sshConnectOptions) ([]ssh.AuthMethod, error) {
	switch opts.AuthType {
	case "", "password":
		return []ssh.AuthMethod{ssh.Password(profile.Secret)}, nil

	case "private_key":
		if profile.Secret == "" {
			return nil, fmt.Errorf("tunnel: private key content required")
		}
		signer, err := parsePrivKey([]byte(profile.Secret), opts.Passphrase)
		if err != nil {
			return nil, fmt.Errorf("tunnel: parse private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil

	case "private_key_file":
		if opts.PrivateKeyPath == "" {
			return nil, fmt.Errorf("tunnel: private_key_path required")
		}
		data, err := os.ReadFile(expandHome(opts.PrivateKeyPath))
		if err != nil {
			return nil, fmt.Errorf("tunnel: read private key file: %w", err)
		}
		signer, err := parsePrivKey(data, opts.Passphrase)
		if err != nil {
			return nil, fmt.Errorf("tunnel: parse private key file: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil

	default:
		return nil, fmt.Errorf("tunnel: unsupported auth_type: %s", opts.AuthType)
	}
}

// parsePrivKey 解析 PEM 私钥，支持可选 passphrase。
func parsePrivKey(pemData []byte, passphrase string) (ssh.Signer, error) {
	if passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase(pemData, []byte(passphrase))
	}
	return ssh.ParsePrivateKey(pemData)
}

// parseSSHOpts 从 SSHProfile.Options（JSON）解析 sshConnectOptions，失败时返回默认值。
func parseSSHOpts(profile *SSHProfile) *sshConnectOptions {
	opts := &sshConnectOptions{
		TimeoutSeconds: 30,
		AuthType:       "password",
	}
	if len(profile.Options) > 0 {
		_ = json.Unmarshal(profile.Options, opts)
	}
	return opts
}

// expandHome 展开路径中的 ~ 为用户主目录。
func expandHome(path string) string {
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home
	}
	if len(path) >= 2 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}
