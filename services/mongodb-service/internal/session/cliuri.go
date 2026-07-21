package session

import (
	"fmt"
	"os"
	"strings"
)

// CLIEnv 为 mongosh 准备连接 URI 与环境变量。
// 密码不写入 URI；mongosh 通过 --password 传入（见 query_exec / shell）。
// MONGODB_PASSWORD 仍写入环境供兼容，但官方 CLI 不会自动读取。
func CLIEnv(params ConnectParams, database string) (uri string, env []string, err error) {
	return cliEnv(params, database, false)
}

// ShellCLIEnv 为 mongosh 准备启动环境：默认库仅来自连接配置或 REPL `use`，不回落到 test。
func ShellCLIEnv(sess *Session) (uri string, env []string, err error) {
	return cliEnv(sess.Params, shellStartupDatabase(sess), false)
}

// CLIToolURI 为 mongo-tools 构造连接 URI。
//
// 有密码时：与 Go 驱动相同，写入完整 userinfo + authSource（特殊字符经 url.UserPassword 编码）。
// 无密码时：去掉用户名与 authSource/authMechanism —— 连接表单默认 auth_database=admin，
// 若仍写入 authSource，部分 mongodump/mongoexport 会发起空凭据 SCRAM 并 AuthenticationFailed，
// 而 Go 驱动 / mongosh 在无凭据时可正常忽略 authSource。
func CLIToolURI(params ConnectParams) (uri string, env []string, err error) {
	p := params
	secret := strings.TrimSpace(p.Secret)
	user := strings.TrimSpace(p.LoginAccount)
	if secret == "" {
		p.Secret = ""
		p.LoginAccount = ""
		p.Options.AuthDatabase = ""
		p.Options.AuthMechanism = ""
	} else if user == "" {
		return "", nil, fmt.Errorf("username required when password is set")
	}
	uri, err = buildURI(p)
	if err != nil {
		return "", nil, err
	}
	return uri, os.Environ(), nil
}

func cliEnv(params ConnectParams, database string, stripAuth bool) (uri string, env []string, err error) {
	p := params
	p.Secret = ""
	if stripAuth {
		p.LoginAccount = ""
		p.Options.AuthDatabase = ""
		p.Options.AuthMechanism = ""
	}
	uri, err = buildURI(p)
	if err != nil {
		return "", nil, err
	}
	if db := strings.TrimSpace(database); db != "" {
		uri = withDatabase(uri, db)
	}
	env = os.Environ()
	if secret := strings.TrimSpace(params.Secret); secret != "" {
		env = append(env, "MONGODB_PASSWORD="+secret)
	}
	return uri, env, nil
}

// shellStartupDatabase 返回 mongosh 启动时应写入 URI 的默认库。
func shellStartupDatabase(s *Session) string {
	s.mu.Lock()
	current := s.currentDatabase
	s.mu.Unlock()
	if current != "" {
		return current
	}
	return strings.TrimSpace(s.Params.Options.DefaultDatabase)
}

func withDatabase(uri, database string) string {
	// mongodb://host:port[/db][?query]
	if idx := strings.Index(uri, "?"); idx >= 0 {
		base, query := uri[:idx], uri[idx:]
		return trimTrailingSlash(base) + "/" + database + query
	}
	return trimTrailingSlash(uri) + "/" + database
}

func trimTrailingSlash(s string) string {
	for strings.HasSuffix(s, "/") {
		s = strings.TrimSuffix(s, "/")
	}
	return s
}

// MongoshArgs 构造 mongosh 启动参数。
func MongoshArgs(uri string) []string {
	return []string{uri}
}

// MongodumpArgs 构造 mongodump 参数。
func MongodumpArgs(uri, database, outputDir string, options map[string]any) []string {
	args := []string{fmt.Sprintf("--uri=%s", uri), "--out", outputDir}
	if database != "" {
		args = append(args, "--db", database)
	}
	return appendToolOptions(args, options)
}

// MongorestoreArgs 构造 mongorestore 参数。
func MongorestoreArgs(uri, inputDir string, options map[string]any) []string {
	args := []string{fmt.Sprintf("--uri=%s", uri), inputDir}
	return appendToolOptions(args, options)
}

// MongoexportArgs 构造 mongoexport 参数。
func MongoexportArgs(uri, database, collection, format, outputPath string) []string {
	args := []string{
		fmt.Sprintf("--uri=%s", uri),
		"--db", database,
		"--collection", collection,
		"--out", outputPath,
	}
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "csv":
		args = append(args, "--type=csv")
	case "json":
		args = append(args, "--jsonArray")
	default:
		args = append(args, "--type=json")
	}
	return args
}

// MongoimportArgs 构造 mongoimport 参数。
func MongoimportArgs(uri, database, collection, format, inputPath string) []string {
	args := []string{
		fmt.Sprintf("--uri=%s", uri),
		"--db", database,
		"--collection", collection,
		"--file", inputPath,
	}
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "csv":
		args = append(args, "--type=csv", "--headerline")
	case "json":
		args = append(args, "--jsonArray")
	default:
		args = append(args, "--type=json")
	}
	return args
}

func appendToolOptions(args []string, options map[string]any) []string {
	if options == nil {
		return args
	}
	for key, value := range options {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		switch v := value.(type) {
		case bool:
			if v {
				args = append(args, "--"+key)
			}
		case string:
			if strings.TrimSpace(v) != "" {
				args = append(args, "--"+key, v)
			}
		case float64:
			args = append(args, "--"+key, fmt.Sprintf("%v", v))
		case int:
			args = append(args, "--"+key, fmt.Sprintf("%d", v))
		}
	}
	return args
}
