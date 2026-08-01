// Package dialect describes the Dameng SQL dialect and probes server features.
package dialect

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const FamilyDameng = "dameng"

const (
	CapDoubleQuoteIdent       = "dameng.double_quote_ident"
	CapQQuote                 = "dameng.q_quote"
	CapProcPLSQLBare          = "proc.plsql_bare"
	CapSplitPLSQLBlocks       = "split.plsql_blocks"
	CapScriptOracleSlash      = "script.oracle_slash"
	CapFormatSQL              = "format.sql"
	CapEditorBuiltinSQL       = "editor.builtin_sql"
	CapEditorSqlLsp           = "editor.sql_lsp"
	CapRoutineCreateProcedure = "routine.create_procedure"
	CapRoutineCreateFunction  = "routine.create_function"
	CapDDLIfNotExists         = "ddl.if_not_exists"
	CapSequenceNative         = "sequence.native"
	CapCompatOracle           = "compat.oracle"
	CapCompatMysql            = "compat.mysql"
	CapDamengIdentity         = "dameng.identity"
)

var ErrNotDameng = errors.New("dameng: server is not Dameng; use the matching connection kind")

type ServerProfile struct {
	Family           string   `json:"family"`
	Version          string   `json:"version,omitempty"`
	VersionNum       string   `json:"versionNum,omitempty"`
	SQLCompatibility string   `json:"sqlCompatibility,omitempty"`
	Capabilities     []string `json:"capabilities"`
}

func Has(p *ServerProfile, capability string) bool {
	if p == nil {
		return false
	}
	for _, c := range p.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

var versionRE = regexp.MustCompile(`(?i)(\d+)\.(\d+)(?:\.(\d+))?`)

func DefaultProfile() ServerProfile { return ResolveCapabilities("", "") }

func ParseVersionNum(version string) string {
	m := versionRE.FindStringSubmatch(version)
	if len(m) == 0 {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch := 0
	if len(m) > 3 {
		patch, _ = strconv.Atoi(m[3])
	}
	return fmt.Sprintf("%d%02d%02d", major, minor, patch)
}

// ResolveCapabilities is intentionally pure so version/compatibility behavior remains testable.
func ResolveCapabilities(version, compat string) ServerProfile {
	caps := []string{CapDoubleQuoteIdent, CapQQuote, CapProcPLSQLBare, CapSplitPLSQLBlocks,
		CapScriptOracleSlash, CapFormatSQL, CapEditorBuiltinSQL, CapEditorSqlLsp, CapRoutineCreateProcedure,
		CapRoutineCreateFunction, CapSequenceNative}
	m := versionRE.FindStringSubmatch(version)
	if len(m) == 0 || func() bool { n, _ := strconv.Atoi(m[1]); return n >= 8 }() {
		caps = append(caps, CapDDLIfNotExists, CapDamengIdentity)
	}
	compat = strings.ToLower(strings.TrimSpace(compat))
	switch {
	case strings.Contains(compat, "oracle"):
		compat = "oracle"
		caps = append(caps, CapCompatOracle)
	case strings.Contains(compat, "mysql"):
		compat = "mysql"
		caps = append(caps, CapCompatMysql)
	default:
		compat = ""
	}
	return ServerProfile{Family: FamilyDameng, Version: strings.TrimSpace(version), VersionNum: ParseVersionNum(version), SQLCompatibility: compat, Capabilities: caps}
}

func Probe(ctx context.Context, db *sql.DB) (*ServerProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("dameng: dialect probe: nil db")
	}
	banner, err := versionBanner(ctx, db)
	if err != nil {
		return nil, fmt.Errorf("dameng: read V$VERSION: %w", err)
	}
	lower := strings.ToLower(banner)
	// 明确排除其它产品；达梦 banner 常含 DM Database / Dameng / DM8。
	if strings.Contains(lower, "postgres") || strings.Contains(lower, "mysql") ||
		strings.Contains(lower, "mariadb") || strings.Contains(lower, "oracle database") {
		return nil, ErrNotDameng
	}
	if !(strings.Contains(lower, "dm database") || strings.Contains(lower, "dameng") ||
		strings.Contains(lower, "dm8") || strings.Contains(lower, "dm database server") ||
		(strings.Contains(lower, "dm") && versionRE.MatchString(banner))) {
		return nil, ErrNotDameng
	}
	compat := ""
	for _, q := range []string{"SELECT SF_GET_PARA_STRING_VALUE(2,'COMPATIBLE_MODE')", "SELECT PARA_VALUE FROM V$PARAMETER WHERE NAME='COMPATIBLE_MODE'"} {
		var v sql.NullString
		if db.QueryRowContext(ctx, q).Scan(&v) == nil && v.Valid {
			compat = v.String
			break
		}
	}
	p := ResolveCapabilities(banner, compat)
	return &p, nil
}

func versionBanner(ctx context.Context, db *sql.DB) (string, error) {
	for _, q := range []string{"SELECT BANNER FROM V$VERSION", "SELECT * FROM V$VERSION", "SELECT ID_CODE FROM V$VERSION"} {
		rows, err := db.QueryContext(ctx, q)
		if err != nil {
			continue
		}
		cols, cerr := rows.Columns()
		if cerr != nil || len(cols) == 0 {
			_ = rows.Close()
			continue
		}
		var parts []string
		for rows.Next() {
			raw := make([]any, len(cols))
			dest := make([]any, len(cols))
			for i := range raw {
				dest[i] = &raw[i]
			}
			if err := rows.Scan(dest...); err != nil {
				continue
			}
			for _, v := range raw {
				if v == nil {
					continue
				}
				if b, ok := v.([]byte); ok {
					parts = append(parts, string(b))
					continue
				}
				s := strings.TrimSpace(fmt.Sprint(v))
				if s != "" && s != "<nil>" {
					parts = append(parts, s)
				}
			}
		}
		err = rows.Err()
		_ = rows.Close()
		if err == nil && len(parts) > 0 {
			return strings.Join(parts, " "), nil
		}
	}
	return "", errors.New("version view unavailable")
}
