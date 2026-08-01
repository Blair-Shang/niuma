package tools

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"niuma/pkg/tunnel"
	"niuma/services/mysql-service/internal/session"
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

// DumpOptions 是 mysqldump 精简参数。
type DumpOptions struct {
	StructureOnly     bool     `json:"structureOnly"`
	DataOnly          bool     `json:"dataOnly"`
	DropIfExists      bool     `json:"dropIfExists"`
	Routines          bool     `json:"routines"`
	Triggers          bool     `json:"triggers"`
	Events            bool     `json:"events"`
	SingleTransaction bool     `json:"singleTransaction"`
	// SetGtidPurged 对应 --set-gtid-purged；空值默认 OFF（逻辑备份跨库还原更安全）。
	SetGtidPurged string   `json:"setGtidPurged,omitempty"`
	Tables        []string `json:"tables,omitempty"`
	// Verbose 对应 --verbose；nil 默认 true，便于任务日志显示进度。
	Verbose *bool `json:"verbose"`
}

// RestoreOptions 是 mysql 客户端还原选项。
type RestoreOptions struct {
	// Force 对应 --force：遇 SQL 错误继续（如表已存在）。
	Force bool `json:"force"`
	// StripGtid 过滤备份中的 GTID_PURGED / SQL_LOG_BIN 语句；nil 默认 true。
	StripGtid *bool `json:"stripGtid"`
	// Verbose 对应 --verbose；nil 默认 true。
	Verbose *bool `json:"verbose"`
}

func portOrDefault(params session.ConnectParams) int {
	if params.PortNumber <= 0 {
		return session.DefaultPort
	}
	return params.PortNumber
}

// PrepareCLI 解析连接参数；SSH 隧道场景下先起转发，使本机工具连本机口。
// 密码通过 MYSQL_PWD 环境变量传递，避免出现在进程参数与日志中。
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
			return nil, fmt.Errorf("mysql: ssh tunnel for tools: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		stop = tunnelStop
	}

	host := strings.TrimSpace(p.HostAddress)
	if host == "" {
		host = "127.0.0.1"
	}
	// Windows 上 localhost 可能走命名管道，统一用 TCP。
	if strings.EqualFold(host, "localhost") {
		host = "127.0.0.1"
	}
	user := strings.TrimSpace(p.LoginAccount)
	if user == "" {
		if stop != nil {
			stop()
		}
		return nil, fmt.Errorf("mysql: login account required for native tools")
	}
	db := strings.TrimSpace(database)
	if db == "" {
		db = p.Options.DatabaseOrEmpty()
	}
	env := os.Environ()
	if secret := strings.TrimSpace(p.Secret); secret != "" {
		env = append(env, "MYSQL_PWD="+secret)
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

// NormalizeDumpOptions 校验互斥项，并规范化 GTID 选项（默认 OFF）。
func NormalizeDumpOptions(opts DumpOptions) (DumpOptions, error) {
	if opts.StructureOnly && opts.DataOnly {
		return opts, fmt.Errorf("mysql: structureOnly and dataOnly are mutually exclusive")
	}
	gtid := strings.ToUpper(strings.TrimSpace(opts.SetGtidPurged))
	if gtid == "" {
		gtid = "OFF"
	}
	switch gtid {
	case "OFF", "ON", "AUTO":
		opts.SetGtidPurged = gtid
	default:
		return opts, fmt.Errorf("mysql: invalid setGtidPurged %q (want OFF|ON|AUTO)", opts.SetGtidPurged)
	}
	if opts.Verbose == nil {
		on := true
		opts.Verbose = &on
	}
	return opts, nil
}

// NormalizeRestoreOptions 规范化还原选项。
// StripGtid 默认开启；Verbose 默认关闭（mysql --verbose 会刷整句 SQL，极易占满内存）。
func NormalizeRestoreOptions(opts RestoreOptions) RestoreOptions {
	if opts.StripGtid == nil {
		on := true
		opts.StripGtid = &on
	}
	if opts.Verbose == nil {
		off := false
		opts.Verbose = &off
	}
	return opts
}

func (o RestoreOptions) stripGtidEnabled() bool {
	return o.StripGtid == nil || *o.StripGtid
}

func boolOrDefault(v *bool, def bool) bool {
	if v == nil {
		return def
	}
	return *v
}

// DumpArgs 根据连接与选项构造 mysqldump 参数（密码不入参数列表）。
func DumpArgs(host, port, user, database, outputPath string, opts DumpOptions) ([]string, error) {
	opts, err := NormalizeDumpOptions(opts)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(database) == "" {
		return nil, fmt.Errorf("mysql: database required for mysqldump")
	}
	if strings.TrimSpace(outputPath) == "" {
		return nil, fmt.Errorf("mysql: outputPath required for mysqldump")
	}
	args := []string{
		"-h", host,
		"-P", port,
		"-u", user,
		"--result-file=" + outputPath,
		"--default-character-set=utf8mb4",
	}
	if opts.StructureOnly {
		args = append(args, "--no-data")
	}
	if opts.DataOnly {
		args = append(args, "--no-create-info")
	}
	if opts.DropIfExists {
		args = append(args, "--add-drop-table")
	}
	if opts.Routines {
		args = append(args, "--routines")
	}
	if opts.Triggers {
		args = append(args, "--triggers")
	} else {
		args = append(args, "--skip-triggers")
	}
	if opts.Events {
		args = append(args, "--events")
	}
	if opts.SingleTransaction {
		args = append(args, "--single-transaction")
	}
	args = append(args, "--set-gtid-purged="+opts.SetGtidPurged)
	if boolOrDefault(opts.Verbose, true) {
		args = append(args, "--verbose")
	}
	args = append(args, database)
	for _, t := range opts.Tables {
		t = strings.TrimSpace(t)
		if t != "" {
			args = append(args, t)
		}
	}
	return args, nil
}

// RestoreArgs 根据连接构造 mysql 客户端参数（SQL 文件通过 stdin 喂入）。
func RestoreArgs(host, port, user, database string, opts RestoreOptions) ([]string, error) {
	if strings.TrimSpace(database) == "" {
		return nil, fmt.Errorf("mysql: database required for mysql restore")
	}
	opts = NormalizeRestoreOptions(opts)
	args := []string{
		"-h", host,
		"-P", port,
		"-u", user,
		"--default-character-set=utf8mb4",
		"--database=" + database,
		// 大备份单行 INSERT 常见，避免 server 因包过大中断
		"--max-allowed-packet=1G",
	}
	if opts.Force {
		args = append(args, "--force")
	}
	if boolOrDefault(opts.Verbose, true) {
		args = append(args, "--verbose")
	}
	return args, nil
}
