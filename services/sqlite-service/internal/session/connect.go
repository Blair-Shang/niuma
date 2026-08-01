// Package session 管理 SQLite 文件连接、会话池与 SQL 查询执行。
//
// 连接参数与 docs/27-sqlite-module.md §4 对齐；对象模型对齐 DBeaver / Navicat / IDEA。
package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	driverName            = "sqlite"
	defaultBusyTimeoutMs  = 5000
	defaultTimeoutSeconds = 10
)

// AttachEntry 描述打开连接后执行的 ATTACH DATABASE。
type AttachEntry struct {
	Alias    string `json:"alias"`
	FilePath string `json:"filePath"`
	Path     string `json:"path"` // 别名
	ReadOnly bool   `json:"readOnly"`
}

// ResolvedPath 返回附加库文件路径。
func (a AttachEntry) ResolvedPath() string {
	for _, p := range []string{a.FilePath, a.Path} {
		if s := strings.TrimSpace(p); s != "" {
			return s
		}
	}
	return ""
}

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	FilePath              string        `json:"filePath"`
	Path                  string        `json:"path"`     // 别名
	Database              string        `json:"database"` // 别名（部分表单复用）
	ReadOnly              bool          `json:"readOnly"`
	CreateIfMissing       bool          `json:"createIfMissing"`
	BusyTimeoutMs         int           `json:"busyTimeoutMs"`
	JournalMode           string        `json:"journalMode"`
	ForeignKeys           *bool         `json:"foreignKeys,omitempty"`
	ExcludeSystemSchemas  *bool         `json:"exclude_system_schemas,omitempty"`
	ConnectTimeoutSeconds int           `json:"connect_timeout_seconds"`
	Attach                []AttachEntry `json:"attach,omitempty"`
}

// FilePathOrEmpty 返回规范化文件路径（options 内字段优先）。
func (o ConnectOptions) FilePathOrEmpty() string {
	for _, p := range []string{o.FilePath, o.Path, o.Database} {
		if s := strings.TrimSpace(p); s != "" {
			return s
		}
	}
	return ""
}

func (o ConnectOptions) busyTimeoutOrDefault() int {
	if o.BusyTimeoutMs > 0 {
		return o.BusyTimeoutMs
	}
	return defaultBusyTimeoutMs
}

func (o ConnectOptions) foreignKeysOrDefault() bool {
	if o.ForeignKeys == nil {
		return true
	}
	return *o.ForeignKeys
}

// ExcludeSystemSchemasEnabled 默认隐藏 sqlite_* 系统表（对齐 DBeaver / IDEA）。
func (o ConnectOptions) ExcludeSystemSchemasEnabled() bool {
	if o.ExcludeSystemSchemas == nil {
		return true
	}
	return *o.ExcludeSystemSchemas
}

func (o ConnectOptions) effectiveTimeout() time.Duration {
	secs := o.ConnectTimeoutSeconds
	if secs <= 0 {
		secs = defaultTimeoutSeconds
	}
	return time.Duration(secs) * time.Second
}

// ConnectParams 是建连参数（含可选口令，仅进程内使用）。
type ConnectParams struct {
	// FilePath 顶层文件路径（与 options.filePath 二选一）。
	FilePath string         `json:"filePath"`
	Path     string         `json:"path"`
	Secret   string         `json:"secret"`
	Options  ConnectOptions `json:"options"`
}

// UnmarshalJSON 兼容 password / 顶层 path 字段。
func (p *ConnectParams) UnmarshalJSON(data []byte) error {
	type alias ConnectParams
	var raw struct {
		alias
		Password string `json:"password"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = ConnectParams(raw.alias)
	if p.Secret == "" && raw.Password != "" {
		p.Secret = raw.Password
	}
	return nil
}

// ResolvedFilePath 合并顶层与 options 中的路径。
func (p ConnectParams) ResolvedFilePath() string {
	for _, cand := range []string{p.FilePath, p.Path, p.Options.FilePathOrEmpty()} {
		if s := strings.TrimSpace(cand); s != "" {
			return s
		}
	}
	return ""
}

// Connect 打开本地 SQLite 文件并 Ping；无隧道 teardown。
func Connect(ctx context.Context, params ConnectParams) (*sql.DB, error) {
	path := params.ResolvedFilePath()
	if path == "" {
		return nil, fmt.Errorf("sqlite: filePath required")
	}
	if path == ":memory:" {
		return nil, fmt.Errorf("sqlite: in-memory databases are not supported for managed connections")
	}
	// modernc 无 SQLCipher；口令已存 Vault 但当前驱动无法解密——拒绝静默忽略。
	if strings.TrimSpace(params.Secret) != "" {
		return nil, fmt.Errorf("sqlite: encryption password is not supported yet (SQLCipher pending); leave password empty for plain SQLite files")
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("sqlite: resolve path: %w", err)
	}

	info, statErr := os.Stat(abs)
	if statErr != nil {
		if !os.IsNotExist(statErr) {
			return nil, fmt.Errorf("sqlite: stat file: %w", statErr)
		}
		if params.Options.ReadOnly || !params.Options.CreateIfMissing {
			return nil, fmt.Errorf("sqlite: file not found: %s", abs)
		}
	} else if info.IsDir() {
		return nil, fmt.Errorf("sqlite: path is a directory: %s", abs)
	}

	dsn, err := buildDSN(abs, params.Options)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlite: open: %w", err)
	}
	// 单连接：对齐专业工具「每站点一连接」写串行，避免 database locked 竞态。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	pingCtx, cancel := context.WithTimeout(ctx, params.Options.effectiveTimeout())
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("sqlite: ping: %w", err)
	}

	if err := applySessionPragmas(pingCtx, db, params.Options); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ApplyAttach(pingCtx, db, params.Options.Attach); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// ApplyAttach 执行 ATTACH DATABASE（幂等：已存在同名 schema 则跳过）。
func ApplyAttach(ctx context.Context, db *sql.DB, entries []AttachEntry) error {
	if db == nil || len(entries) == 0 {
		return nil
	}
	existing, err := attachedSchemaSet(ctx, db)
	if err != nil {
		return err
	}
	for _, e := range entries {
		alias := strings.TrimSpace(e.Alias)
		path := e.ResolvedPath()
		if alias == "" || path == "" {
			return fmt.Errorf("sqlite: attach requires alias and filePath")
		}
		if !isSafeIdent(alias) {
			return fmt.Errorf("sqlite: invalid attach alias")
		}
		if _, ok := existing[strings.ToLower(alias)]; ok {
			continue
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("sqlite: attach resolve path: %w", err)
		}
		sqlText := "ATTACH DATABASE " + quoteLiteral(abs) + " AS " + quoteIdent(alias)
		if e.ReadOnly {
			// SQLite 3.x：ATTACH … AS name 后可用 PRAGMA query_only；URI mode=ro 更稳妥
			sqlText = "ATTACH DATABASE " + quoteLiteral("file:"+filepath.ToSlash(abs)+"?mode=ro") + " AS " + quoteIdent(alias)
		}
		if _, err := db.ExecContext(ctx, sqlText); err != nil {
			return fmt.Errorf("sqlite: attach %s: %w", alias, err)
		}
		existing[strings.ToLower(alias)] = struct{}{}
	}
	return nil
}

// ApplyDetach 执行 DETACH DATABASE（禁止卸载 main/temp）。
func ApplyDetach(ctx context.Context, db *sql.DB, aliases []string) error {
	if db == nil || len(aliases) == 0 {
		return nil
	}
	for _, raw := range aliases {
		alias := strings.TrimSpace(raw)
		if alias == "" {
			continue
		}
		lower := strings.ToLower(alias)
		if lower == "main" || lower == "temp" {
			return fmt.Errorf("sqlite: cannot detach %s", alias)
		}
		if !isSafeIdent(alias) {
			return fmt.Errorf("sqlite: invalid detach alias")
		}
		if _, err := db.ExecContext(ctx, "DETACH DATABASE "+quoteIdent(alias)); err != nil {
			return fmt.Errorf("sqlite: detach %s: %w", alias, err)
		}
	}
	return nil
}

func attachedSchemaSet(ctx context.Context, db *sql.DB) (map[string]struct{}, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA database_list`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: database_list: %w", err)
	}
	defer rows.Close()
	out := make(map[string]struct{})
	for rows.Next() {
		var seq int
		var name, file string
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return nil, err
		}
		out[strings.ToLower(strings.TrimSpace(name))] = struct{}{}
	}
	return out, rows.Err()
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func quoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

func isSafeIdent(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
		case r >= '0' && r <= '9':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func buildDSN(absPath string, opts ConnectOptions) (string, error) {
	// modernc URI：file:///abs/path?mode=…（Windows 为 file:///C:/…）
	slash := filepath.ToSlash(absPath)
	if runtime.GOOS == "windows" && !strings.HasPrefix(slash, "/") {
		slash = "/" + slash
	}
	q := url.Values{}
	switch {
	case opts.ReadOnly:
		q.Set("mode", "ro")
	case opts.CreateIfMissing:
		q.Set("mode", "rwc")
	default:
		q.Set("mode", "rw")
	}
	q.Set("_pragma", fmt.Sprintf("busy_timeout(%d)", opts.busyTimeoutOrDefault()))
	u := url.URL{
		Scheme:   "file",
		Path:     slash,
		RawQuery: q.Encode(),
	}
	return u.String(), nil
}

func applySessionPragmas(ctx context.Context, db *sql.DB, opts ConnectOptions) error {
	if opts.foreignKeysOrDefault() {
		if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
			return fmt.Errorf("sqlite: pragma foreign_keys: %w", err)
		}
	}
	mode := strings.TrimSpace(opts.JournalMode)
	if mode == "" || opts.ReadOnly {
		return nil
	}
	if !isSafePragmaValue(mode) {
		return fmt.Errorf("sqlite: invalid journalMode")
	}
	if _, err := db.ExecContext(ctx, "PRAGMA journal_mode = "+mode); err != nil {
		return fmt.Errorf("sqlite: pragma journal_mode: %w", err)
	}
	return nil
}

func isSafePragmaValue(s string) bool {
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return s != ""
}

// ProbeVersion 返回 sqlite_version()。
func ProbeVersion(ctx context.Context, db *sql.DB) (string, error) {
	var version string
	if err := db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version); err != nil {
		return "", err
	}
	return strings.TrimSpace(version), nil
}
