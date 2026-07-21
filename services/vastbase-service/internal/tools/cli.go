package tools

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"niuma/pkg/tunnel"
	"niuma/services/vastbase-service/internal/session"
)

// CLIEndpoint 是原生工具可用的本机可达连接端点。
type CLIEndpoint struct {
	Env      []string
	Host     string
	Port     string
	User     string
	Database string
	Stop     func()
}

func portOrDefault(params session.ConnectParams) int {
	if params.PortNumber <= 0 {
		return session.DefaultPort
	}
	return params.PortNumber
}

// PrepareCLI 解析连接参数；SSH 隧道场景下先起转发，使本机工具连本机口。
func PrepareCLI(ctx context.Context, params session.ConnectParams, database string) (*CLIEndpoint, error) {
	p := params
	var stop func()
	if p.Options.Tunnel != nil && p.Options.Tunnel.Enabled() {
		host, port, tunnelStop, err := tunnel.StartSSHTunnel(
			ctx,
			p.Options.Tunnel,
			p.HostAddress,
			portOrDefault(p),
		)
		if err != nil {
			return nil, fmt.Errorf("vastbase: ssh tunnel for tools: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		stop = tunnelStop
	}

	host := strings.TrimSpace(p.HostAddress)
	if host == "" {
		host = "127.0.0.1"
	}
	user := strings.TrimSpace(p.LoginAccount)
	if user == "" {
		if stop != nil {
			stop()
		}
		return nil, fmt.Errorf("vastbase: login account required for native tools")
	}
	db := strings.TrimSpace(database)
	if db == "" {
		db = p.Options.DatabaseOrDefault()
	}
	env := os.Environ()
	if secret := strings.TrimSpace(p.Secret); secret != "" {
		env = append(env, "PGPASSWORD="+secret)
	}
	return &CLIEndpoint{
		Env:      env,
		Host:     host,
		Port:     strconv.Itoa(portOrDefault(p)),
		User:     user,
		Database: db,
		Stop:     stop,
	}, nil
}
