package session

import (
	"fmt"
	"os"
	"strings"
)

// CLIEnv 为外部 CLI 工具准备连接 URI 与环境变量（密码不入 URI、不写日志）。
func CLIEnv(params ConnectParams, database string) (uri string, env []string, err error) {
	p := params
	p.Secret = ""
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
